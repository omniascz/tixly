import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createContract,
  deactivateContract,
  generateReport,
  getReport,
  getDashboard,
  listContractsForOrganizer,
  scheduleReportGeneration,
} from '../services/sponsor-analytics.service'
import {
  ContractInput,
  DataWarehouseAdapter,
  DbAdapter,
  ServiceDeps,
  SponsorAnalyticsError,
  SponsorContract,
  SponsorReport,
  SponsorReportData,
} from '../types/sponsor-analytics.types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-15T10:00:00Z')

function makeContractRow(overrides: Partial<SponsorContract> = {}): SponsorContract {
  return {
    id: 'contract-1',
    organizerId: 'organizer-1',
    sponsorName: 'Acme Corp',
    sponsorEmail: 'sponsor@acme.com',
    eventId: 'event-1',
    tier: 'gold',
    dataPackages: ['demographic', 'geographic'],
    contractStart: new Date('2026-01-01T00:00:00Z'),
    contractEnd: new Date('2026-12-31T23:59:59Z'),
    priceCzk: 50000,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeReportRow(overrides: Partial<SponsorReport> = {}): SponsorReport {
  return {
    id: 'report-1',
    contractId: 'contract-1',
    eventId: 'event-1',
    reportType: 'demographic',
    status: 'ready',
    generatedAt: new Date('2026-04-15T10:00:00Z'),
    data: { totalAttendees: 1500, ageGroups: { '18-24': 400, '25-34': 1100 } },
    ...overrides,
  }
}

const DEMO_DATA: SponsorReportData = {
  ageGroups: { '18-24': 450, '25-34': 1200 },
  genderSplit: { male: 900, female: 800 },
  totalAttendees: 1700,
  dataAsOf: '2026-04-15',
}

const GEO_DATA: SponsorReportData = {
  cityBreakdown: { Praha: 1000, Brno: 400 },
  regionBreakdown: { Čechy: 1200, Morava: 500 },
  totalAttendees: 1700,
  dataAsOf: '2026-04-15',
}

const PURCHASE_DATA: SponsorReportData = {
  averageOrderValueCzk: 850,
  repeatPurchaseRate: 0.23,
  ticketCategories: { standard: 1200, vip: 300 },
  totalAttendees: 1700,
  dataAsOf: '2026-04-15',
}

const ENGAGEMENT_DATA: SponsorReportData = {
  emailOpenRate: 0.42,
  appSessionsPerUser: 3.2,
  checkInRate: 0.91,
  totalAttendees: 1700,
  dataAsOf: '2026-04-15',
}

function makeWarehouse(overrides: Partial<DataWarehouseAdapter> = {}): DataWarehouseAdapter {
  return {
    getDemographics: vi.fn(async () => DEMO_DATA),
    getGeographic: vi.fn(async () => GEO_DATA),
    getPurchasePatterns: vi.fn(async () => PURCHASE_DATA),
    getEngagement: vi.fn(async () => ENGAGEMENT_DATA),
    ...overrides,
  }
}

function makeDb(opts: {
  contract?: SponsorContract | null
  report?: SponsorReport | null
  contracts?: SponsorContract[]
  reports?: SponsorReport[]
} = {}): DbAdapter {
  const contract = opts.contract !== undefined ? opts.contract : makeContractRow()
  const report = opts.report !== undefined ? opts.report : null
  const contracts = opts.contracts ?? (contract ? [contract] : [])
  const reports = opts.reports ?? (report ? [report] : [])

  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('sponsor_contracts') && sql.includes('organizer_id')) {
        return contracts as unknown[]
      }
      if (sql.includes('sponsor_contracts')) {
        return (contract ? [contract] : []) as unknown[]
      }
      if (sql.includes('sponsor_reports')) {
        return reports as unknown[]
      }
      return []
    }),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(makeDb(opts) as DbAdapter)),
  }
}

function makeDeps(opts: {
  contract?: SponsorContract | null
  report?: SponsorReport | null
  contracts?: SponsorContract[]
  reports?: SponsorReport[]
  warehouse?: Partial<DataWarehouseAdapter>
  now?: () => Date
} = {}): ServiceDeps {
  return {
    db: makeDb(opts),
    dataWarehouse: makeWarehouse(opts.warehouse),
    now: opts.now ?? (() => FIXED_NOW),
  }
}

const BASE_INPUT: ContractInput = {
  organizerId: 'organizer-1',
  sponsorName: 'Acme Corp',
  sponsorEmail: 'sponsor@acme.com',
  eventId: 'event-1',
  tier: 'gold',
  dataPackages: ['demographic', 'geographic'],
  contractStart: new Date('2026-01-01T00:00:00Z'),
  contractEnd: new Date('2026-12-31T23:59:59Z'),
  priceCzk: 50000,
}

// ── createContract ─────────────────────────────────────────────────────────────

describe('createContract', () => {
  it('returns a SponsorContract with isActive=true and correct fields', async () => {
    const deps = makeDeps()
    const result = await createContract(BASE_INPUT, deps)

    expect(result.isActive).toBe(true)
    expect(result.sponsorName).toBe('Acme Corp')
    expect(result.organizerId).toBe('organizer-1')
    expect(result.eventId).toBe('event-1')
    expect(result.tier).toBe('gold')
    expect(result.dataPackages).toEqual(['demographic', 'geographic'])
    expect(result.priceCzk).toBe(50000)
    expect(result.id).toBeTruthy()
    expect(result.createdAt).toEqual(FIXED_NOW)
  })

  it('sets eventId to null when not provided in input', async () => {
    const deps = makeDeps()
    const input: ContractInput = { ...BASE_INPUT }
    delete (input as Partial<ContractInput>).eventId
    const result = await createContract(input, deps)
    expect(result.eventId).toBeNull()
  })

  it('calls db.execute with INSERT statement', async () => {
    const deps = makeDeps()
    await createContract(BASE_INPUT, deps)
    expect(deps.db.execute).toHaveBeenCalledOnce()
    const [sql] = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO sponsor_contracts')
  })
})

// ── deactivateContract ────────────────────────────────────────────────────────

describe('deactivateContract', () => {
  it('calls db.execute with UPDATE to set is_active=false', async () => {
    const deps = makeDeps({ contract: makeContractRow() })
    await deactivateContract('contract-1', deps)

    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls as [string][]
    expect(executeCalls.some(([sql]) => sql.includes('UPDATE') && sql.includes('is_active'))).toBe(true)
  })

  it('throws CONTRACT_NOT_FOUND when contract does not exist', async () => {
    const deps = makeDeps({ contract: null })
    await expect(deactivateContract('nonexistent', deps)).rejects.toThrow(SponsorAnalyticsError)
    await expect(deactivateContract('nonexistent', deps)).rejects.toMatchObject({
      code: 'CONTRACT_NOT_FOUND',
    })
  })
})

// ── generateReport ─────────────────────────────────────────────────────────────

describe('generateReport — success cases', () => {
  it('generates a demographic report and returns status=ready', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['demographic'] }) })
    const report = await generateReport('contract-1', 'demographic', deps)

    expect(report.status).toBe('ready')
    expect(report.reportType).toBe('demographic')
    expect(report.data).toMatchObject({ ageGroups: expect.any(Object) })
    expect(report.generatedAt).toEqual(FIXED_NOW)
    expect(deps.dataWarehouse.getDemographics).toHaveBeenCalledWith('event-1')
  })

  it('generates a geographic report', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['geographic'] }) })
    const report = await generateReport('contract-1', 'geographic', deps)

    expect(report.status).toBe('ready')
    expect(report.reportType).toBe('geographic')
    expect(deps.dataWarehouse.getGeographic).toHaveBeenCalledWith('event-1')
  })

  it('generates a purchase_patterns report', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['purchase_patterns'] }) })
    const report = await generateReport('contract-1', 'purchase_patterns', deps)

    expect(report.status).toBe('ready')
    expect(report.reportType).toBe('purchase_patterns')
    expect(deps.dataWarehouse.getPurchasePatterns).toHaveBeenCalledWith('event-1')
  })

  it('generates an engagement report', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['engagement'] }) })
    const report = await generateReport('contract-1', 'engagement', deps)

    expect(report.status).toBe('ready')
    expect(report.reportType).toBe('engagement')
    expect(deps.dataWarehouse.getEngagement).toHaveBeenCalledWith('event-1')
  })

  it('generates a full_suite report by calling all four warehouse methods', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['full_suite'] }) })
    const report = await generateReport('contract-1', 'full_suite', deps)

    expect(report.status).toBe('ready')
    expect(deps.dataWarehouse.getDemographics).toHaveBeenCalledWith('event-1')
    expect(deps.dataWarehouse.getGeographic).toHaveBeenCalledWith('event-1')
    expect(deps.dataWarehouse.getPurchasePatterns).toHaveBeenCalledWith('event-1')
    expect(deps.dataWarehouse.getEngagement).toHaveBeenCalledWith('event-1')
  })

  it('allows full_suite report when contract has full_suite in dataPackages for non-full_suite type', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['full_suite'] }) })
    const report = await generateReport('contract-1', 'demographic', deps)
    expect(report.status).toBe('ready')
  })

  it('inserts report with generating status then updates to ready', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['demographic'] }) })
    await generateReport('contract-1', 'demographic', deps)

    const executeCalls = (deps.db.execute as ReturnType<typeof vi.fn>).mock.calls as [string][]
    const insertCall = executeCalls.find(([sql]) => sql.includes('INSERT INTO sponsor_reports'))
    const updateCall = executeCalls.find(([sql]) => sql.includes('UPDATE sponsor_reports'))
    expect(insertCall).toBeTruthy()
    expect(updateCall).toBeTruthy()
  })
})

describe('generateReport — error cases', () => {
  it('throws PACKAGE_NOT_INCLUDED when reportType not in contract.dataPackages', async () => {
    const deps = makeDeps({ contract: makeContractRow({ dataPackages: ['demographic'] }) })
    await expect(generateReport('contract-1', 'engagement', deps)).rejects.toMatchObject({
      code: 'PACKAGE_NOT_INCLUDED',
    })
  })

  it('throws CONTRACT_EXPIRED when contract.contractEnd is in the past', async () => {
    const expired = makeContractRow({
      contractEnd: new Date('2025-01-01T00:00:00Z'),
      dataPackages: ['demographic'],
    })
    const deps = makeDeps({ contract: expired })
    await expect(generateReport('contract-1', 'demographic', deps)).rejects.toMatchObject({
      code: 'CONTRACT_EXPIRED',
    })
  })

  it('throws CONTRACT_EXPIRED when contract.isActive is false', async () => {
    const inactive = makeContractRow({ isActive: false, dataPackages: ['demographic'] })
    const deps = makeDeps({ contract: inactive })
    await expect(generateReport('contract-1', 'demographic', deps)).rejects.toMatchObject({
      code: 'CONTRACT_EXPIRED',
    })
  })

  it('throws CONTRACT_NOT_FOUND when contract does not exist', async () => {
    const deps = makeDeps({ contract: null })
    await expect(generateReport('missing', 'demographic', deps)).rejects.toMatchObject({
      code: 'CONTRACT_NOT_FOUND',
    })
  })
})

// ── getReport ──────────────────────────────────────────────────────────────────

describe('getReport', () => {
  it('returns report when found', async () => {
    const report = makeReportRow({ status: 'ready' })
    const deps = makeDeps({ report })
    const result = await getReport('report-1', deps)
    expect(result.id).toBe('report-1')
    expect(result.status).toBe('ready')
  })

  it('throws REPORT_NOT_FOUND when report does not exist', async () => {
    const deps = makeDeps({ report: null })
    await expect(getReport('nonexistent', deps)).rejects.toMatchObject({
      code: 'REPORT_NOT_FOUND',
    })
  })

  it('returns report even when status is pending (not ready)', async () => {
    const pending = makeReportRow({ status: 'pending', data: null, generatedAt: null })
    const deps = makeDeps({ report: pending })
    const result = await getReport('report-1', deps)
    expect(result.status).toBe('pending')
    expect(result.data).toBeNull()
  })
})

// ── getDashboard ───────────────────────────────────────────────────────────────

describe('getDashboard', () => {
  it('returns correct contractDaysRemaining', async () => {
    const contract = makeContractRow({
      contractEnd: new Date('2026-04-25T00:00:00Z'), // 10 days after FIXED_NOW
    })
    const deps = makeDeps({ contract, reports: [] })
    const dashboard = await getDashboard('contract-1', deps)
    // 2026-04-15 to 2026-04-25 = 10 days
    expect(dashboard.contractDaysRemaining).toBe(10)
  })

  it('returns 0 contractDaysRemaining when contract has expired', async () => {
    const contract = makeContractRow({
      contractEnd: new Date('2026-01-01T00:00:00Z'),
    })
    const deps = makeDeps({ contract, reports: [] })
    const dashboard = await getDashboard('contract-1', deps)
    expect(dashboard.contractDaysRemaining).toBe(0)
  })

  it('includes recentReports in dashboard', async () => {
    const contract = makeContractRow()
    const reports = [makeReportRow(), makeReportRow({ id: 'report-2', reportType: 'geographic' })]
    const deps = makeDeps({ contract, reports })
    const dashboard = await getDashboard('contract-1', deps)
    expect(dashboard.recentReports).toHaveLength(2)
  })

  it('sets totalAttendees from most recent ready report data', async () => {
    const contract = makeContractRow()
    const reports = [
      makeReportRow({ status: 'ready', data: { totalAttendees: 2500 } }),
    ]
    const deps = makeDeps({ contract, reports })
    const dashboard = await getDashboard('contract-1', deps)
    expect(dashboard.totalAttendees).toBe(2500)
  })

  it('returns correct sponsorName and tier', async () => {
    const contract = makeContractRow({ sponsorName: 'TestSponsor', tier: 'platinum' })
    const deps = makeDeps({ contract, reports: [] })
    const dashboard = await getDashboard('contract-1', deps)
    expect(dashboard.sponsorName).toBe('TestSponsor')
    expect(dashboard.tier).toBe('platinum')
  })

  it('expands full_suite dataPackagesAvailable to all four types', async () => {
    const contract = makeContractRow({ dataPackages: ['full_suite'] })
    const deps = makeDeps({ contract, reports: [] })
    const dashboard = await getDashboard('contract-1', deps)
    expect(dashboard.dataPackagesAvailable).toContain('demographic')
    expect(dashboard.dataPackagesAvailable).toContain('geographic')
    expect(dashboard.dataPackagesAvailable).toContain('purchase_patterns')
    expect(dashboard.dataPackagesAvailable).toContain('engagement')
  })
})

// ── listContractsForOrganizer ──────────────────────────────────────────────────

describe('listContractsForOrganizer', () => {
  it('returns all contracts for the given organizer', async () => {
    const contracts = [
      makeContractRow({ id: 'c1' }),
      makeContractRow({ id: 'c2' }),
      makeContractRow({ id: 'c3' }),
    ]
    const deps = makeDeps({ contracts })
    const result = await listContractsForOrganizer('organizer-1', deps)
    expect(result).toHaveLength(3)
  })

  it('returns empty array when organizer has no contracts', async () => {
    const deps = makeDeps({ contracts: [], contract: null })
    const result = await listContractsForOrganizer('no-organizer', deps)
    expect(result).toEqual([])
  })

  it('queries db with organizer_id filter', async () => {
    const deps = makeDeps({ contracts: [] })
    await listContractsForOrganizer('organizer-1', deps)
    const [sql, params] = (deps.db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('organizer_id')
    expect(params).toContain('organizer-1')
  })
})

// ── scheduleReportGeneration ───────────────────────────────────────────────────

describe('scheduleReportGeneration', () => {
  it('calls generateReport (warehouse) sequentially for each package type', async () => {
    const contract = makeContractRow({ dataPackages: ['demographic', 'geographic', 'engagement'] })
    const deps = makeDeps({ contract })
    const results = await scheduleReportGeneration(
      'contract-1',
      ['demographic', 'geographic', 'engagement'],
      deps,
    )

    expect(results).toHaveLength(3)
    expect(deps.dataWarehouse.getDemographics).toHaveBeenCalledWith('event-1')
    expect(deps.dataWarehouse.getGeographic).toHaveBeenCalledWith('event-1')
    expect(deps.dataWarehouse.getEngagement).toHaveBeenCalledWith('event-1')
    expect(deps.dataWarehouse.getPurchasePatterns).not.toHaveBeenCalled()
  })

  it('returns one report per requested type in order', async () => {
    const contract = makeContractRow({ dataPackages: ['demographic', 'purchase_patterns'] })
    const deps = makeDeps({ contract })
    const results = await scheduleReportGeneration(
      'contract-1',
      ['demographic', 'purchase_patterns'],
      deps,
    )

    expect(results[0]?.reportType).toBe('demographic')
    expect(results[1]?.reportType).toBe('purchase_patterns')
  })

  it('stops and propagates error when a package is not included in contract', async () => {
    const contract = makeContractRow({ dataPackages: ['demographic'] })
    const deps = makeDeps({ contract })
    await expect(
      scheduleReportGeneration('contract-1', ['demographic', 'engagement'], deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_INCLUDED' })
  })
})
