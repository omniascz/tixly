import {
  ContractInput,
  DataPackageType,
  DbAdapter,
  ServiceDeps,
  SponsorAnalyticsError,
  SponsorContract,
  SponsorDashboard,
  SponsorReport,
  SponsorReportData,
} from '../types/sponsor-analytics.types'

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function createContract(
  input: ContractInput,
  deps: ServiceDeps,
): Promise<SponsorContract> {
  const { db, now = () => new Date() } = deps
  const id = generateId()
  const createdAt = now()

  const contract: SponsorContract = {
    id,
    organizerId: input.organizerId,
    sponsorName: input.sponsorName,
    sponsorEmail: input.sponsorEmail,
    eventId: input.eventId ?? null,
    tier: input.tier,
    dataPackages: input.dataPackages,
    contractStart: input.contractStart,
    contractEnd: input.contractEnd,
    priceCzk: input.priceCzk,
    isActive: true,
    createdAt,
  }

  await db.execute(
    `INSERT INTO sponsor_contracts
      (id, organizer_id, sponsor_name, sponsor_email, event_id, tier,
       data_packages, contract_start, contract_end, price_czk, is_active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      contract.id,
      contract.organizerId,
      contract.sponsorName,
      contract.sponsorEmail,
      contract.eventId,
      contract.tier,
      JSON.stringify(contract.dataPackages),
      contract.contractStart.toISOString(),
      contract.contractEnd.toISOString(),
      contract.priceCzk,
      contract.isActive,
      contract.createdAt.toISOString(),
    ],
  )

  return contract
}

export async function deactivateContract(
  contractId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps
  const rows = await db.query<SponsorContract>(
    'SELECT * FROM sponsor_contracts WHERE id = $1',
    [contractId],
  )
  if (rows.length === 0) {
    throw new SponsorAnalyticsError('CONTRACT_NOT_FOUND', `Contract not found: ${contractId}`)
  }
  await db.execute(
    'UPDATE sponsor_contracts SET is_active = false WHERE id = $1',
    [contractId],
  )
}

async function fetchContractById(contractId: string, db: DbAdapter): Promise<SponsorContract> {
  const rows = await db.query<SponsorContract>(
    'SELECT * FROM sponsor_contracts WHERE id = $1',
    [contractId],
  )
  if (rows.length === 0) {
    throw new SponsorAnalyticsError('CONTRACT_NOT_FOUND', `Contract not found: ${contractId}`)
  }
  return rows[0] as SponsorContract
}

const ALL_PACKAGE_TYPES: DataPackageType[] = [
  'demographic',
  'geographic',
  'purchase_patterns',
  'engagement',
]

function packageAllowed(contract: SponsorContract, reportType: DataPackageType): boolean {
  if (reportType === 'full_suite') return true
  if (contract.dataPackages.includes('full_suite')) return true
  return contract.dataPackages.includes(reportType)
}

export async function generateReport(
  contractId: string,
  reportType: DataPackageType,
  deps: ServiceDeps,
): Promise<SponsorReport> {
  const { db, dataWarehouse, now = () => new Date() } = deps

  const contract = await fetchContractById(contractId, db)

  if (!contract.isActive) {
    throw new SponsorAnalyticsError('CONTRACT_EXPIRED', `Contract ${contractId} is not active`)
  }

  const currentDate = now()
  if (currentDate > contract.contractEnd) {
    throw new SponsorAnalyticsError('CONTRACT_EXPIRED', `Contract ${contractId} has expired`)
  }

  if (!packageAllowed(contract, reportType)) {
    throw new SponsorAnalyticsError(
      'PACKAGE_NOT_INCLUDED',
      `Report type '${reportType}' is not included in contract ${contractId}`,
    )
  }

  const reportId = generateId()
  const generatingReport: SponsorReport = {
    id: reportId,
    contractId,
    eventId: contract.eventId,
    reportType,
    status: 'generating',
    generatedAt: null,
    data: null,
  }

  await db.execute(
    `INSERT INTO sponsor_reports (id, contract_id, event_id, report_type, status, generated_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [reportId, contractId, contract.eventId, reportType, 'generating', null, null],
  )

  let data: SponsorReportData

  if (reportType === 'full_suite') {
    const [demographic, geographic, purchasePatterns, engagement] = await Promise.all([
      dataWarehouse.getDemographics(contract.eventId),
      dataWarehouse.getGeographic(contract.eventId),
      dataWarehouse.getPurchasePatterns(contract.eventId),
      dataWarehouse.getEngagement(contract.eventId),
    ])
    data = { ...demographic, ...geographic, ...purchasePatterns, ...engagement }
  } else if (reportType === 'demographic') {
    data = await dataWarehouse.getDemographics(contract.eventId)
  } else if (reportType === 'geographic') {
    data = await dataWarehouse.getGeographic(contract.eventId)
  } else if (reportType === 'purchase_patterns') {
    data = await dataWarehouse.getPurchasePatterns(contract.eventId)
  } else {
    data = await dataWarehouse.getEngagement(contract.eventId)
  }

  const generatedAt = now()

  await db.execute(
    `UPDATE sponsor_reports SET status = $1, data = $2, generated_at = $3 WHERE id = $4`,
    ['ready', JSON.stringify(data), generatedAt.toISOString(), reportId],
  )

  const readyReport: SponsorReport = {
    ...generatingReport,
    status: 'ready',
    generatedAt,
    data,
  }

  return readyReport
}

export async function getReport(
  reportId: string,
  deps: ServiceDeps,
): Promise<SponsorReport> {
  const { db } = deps
  const rows = await db.query<SponsorReport>(
    'SELECT * FROM sponsor_reports WHERE id = $1',
    [reportId],
  )
  if (rows.length === 0) {
    throw new SponsorAnalyticsError('REPORT_NOT_FOUND', `Report not found: ${reportId}`)
  }
  return rows[0] as SponsorReport
}

export async function getDashboard(
  contractId: string,
  deps: ServiceDeps,
): Promise<SponsorDashboard> {
  const { db, now = () => new Date() } = deps

  const contract = await fetchContractById(contractId, db)

  const reports = await db.query<SponsorReport>(
    'SELECT * FROM sponsor_reports WHERE contract_id = $1 ORDER BY generated_at DESC LIMIT 5',
    [contractId],
  )

  const currentDate = now()
  const msRemaining = contract.contractEnd.getTime() - currentDate.getTime()
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)))

  // Compute totalAttendees from the most recent ready report data
  let totalAttendees = 0
  for (const report of reports) {
    if (report.status === 'ready' && report.data && report.data.totalAttendees !== undefined) {
      totalAttendees = report.data.totalAttendees
      break
    }
  }

  const availablePackages: DataPackageType[] = contract.dataPackages.includes('full_suite')
    ? ALL_PACKAGE_TYPES
    : contract.dataPackages.filter((p): p is DataPackageType => p !== 'full_suite')

  return {
    contractId,
    sponsorName: contract.sponsorName,
    tier: contract.tier,
    totalAttendees,
    recentReports: reports,
    dataPackagesAvailable: availablePackages,
    contractDaysRemaining: daysRemaining,
  }
}

export async function listContractsForOrganizer(
  organizerId: string,
  deps: ServiceDeps,
): Promise<SponsorContract[]> {
  const { db } = deps
  return db.query<SponsorContract>(
    'SELECT * FROM sponsor_contracts WHERE organizer_id = $1 ORDER BY created_at DESC',
    [organizerId],
  )
}

export async function scheduleReportGeneration(
  contractId: string,
  reportTypes: DataPackageType[],
  deps: ServiceDeps,
): Promise<SponsorReport[]> {
  const results: SponsorReport[] = []
  for (const reportType of reportTypes) {
    const report = await generateReport(contractId, reportType, deps)
    results.push(report)
  }
  return results
}
