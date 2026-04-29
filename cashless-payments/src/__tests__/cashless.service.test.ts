import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerWallet,
  topUpWallet,
  processVendorPurchase,
  refundToWallet,
  freezeWallet,
  closeEvent,
  getWalletBalance,
  getTransactionHistory,
  getEventStats,
} from '../services/cashless.service'
import {
  CashlessError,
  CashlessWallet,
  CashlessTransaction,
  Vendor,
  DbAdapter,
  ServiceDeps,
} from '../types/cashless.types'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWallet(overrides: Partial<CashlessWallet> = {}): CashlessWallet {
  return {
    id: 'wallet-1',
    eventId: 'event-1',
    attendeeId: 'attendee-1',
    rfidUid: 'RFID-AAA',
    balanceCzk: 50000, // 500 Kč
    status: 'active',
    createdAt: new Date('2026-04-01T10:00:00Z'),
    updatedAt: new Date('2026-04-01T10:00:00Z'),
    ...overrides,
  }
}

function makeTransaction(overrides: Partial<CashlessTransaction> = {}): CashlessTransaction {
  return {
    id: 'tx-1',
    walletId: 'wallet-1',
    vendorId: null,
    type: 'top_up',
    amountCzk: 10000,
    balanceAfterCzk: 10000,
    description: 'Top-up',
    terminalId: null,
    occurredAt: new Date('2026-04-01T11:00:00Z'),
    ...overrides,
  }
}

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: 'vendor-1',
    eventId: 'event-1',
    name: 'Beer Stand',
    category: 'food_beverage',
    terminalIds: ['terminal-1'],
    isActive: true,
    ...overrides,
  }
}

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  const db: DbAdapter = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(db)),
    ...overrides,
  }
  return db
}

function makeDeps(dbOverrides: Partial<DbAdapter> = {}): ServiceDeps {
  return { db: makeDb(dbOverrides) }
}

// ── registerWallet ─────────────────────────────────────────────────────────

describe('registerWallet', () => {
  it('creates a new wallet with status active and balance 0', async () => {
    const wallet = makeWallet({ balanceCzk: 0, status: 'active' })
    const db = makeDb({
      query: vi.fn(async () => [wallet]),
    })
    const deps: ServiceDeps = { db }

    const result = await registerWallet('RFID-AAA', 'event-1', 'attendee-1', deps)

    expect(db.execute).toHaveBeenCalledOnce()
    const insertCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(insertCall[1]).toContain('RFID-AAA')
    expect(insertCall[1]).toContain('event-1')
    expect(insertCall[1]).toContain('attendee-1')
    expect(insertCall[1]).toContain(0)         // balance
    expect(insertCall[1]).toContain('active')  // status
    expect(result.status).toBe('active')
    expect(result.balanceCzk).toBe(0)
  })

  it('throws WALLET_NOT_FOUND when db returns empty rows after insert (duplicate RFID)', async () => {
    const db = makeDb({
      query: vi.fn(async () => []),
    })
    const deps: ServiceDeps = { db }

    await expect(registerWallet('RFID-DUP', 'event-1', 'attendee-2', deps)).rejects.toThrow(CashlessError)
    await expect(registerWallet('RFID-DUP', 'event-1', 'attendee-2', deps)).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    })
  })
})

// ── topUpWallet ────────────────────────────────────────────────────────────

describe('topUpWallet', () => {
  it('adds credits and inserts a top_up transaction', async () => {
    const wallet = makeWallet({ balanceCzk: 20000 })
    const tx = makeTransaction({ type: 'top_up', amountCzk: 10000, balanceAfterCzk: 30000 })

    let queryCallCount = 0
    const db = makeDb({
      query: vi.fn(async () => {
        queryCallCount++
        if (queryCallCount === 1) return [wallet]
        return [tx]
      }),
      transaction: vi.fn(async (fn) => {
        const txDb: DbAdapter = {
          query: vi.fn(async () => {
            queryCallCount++
            if (queryCallCount === 1) return [wallet]
            return [tx]
          }),
          execute: vi.fn(async () => undefined),
          transaction: vi.fn(),
        }
        return fn(txDb)
      }),
    })

    const deps: ServiceDeps = { db }
    const result = await topUpWallet(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', amountCzk: 10000, description: 'Cash top-up' },
      deps,
    )

    expect(db.transaction).toHaveBeenCalledOnce()
    expect(result.type).toBe('top_up')
    expect(result.amountCzk).toBe(10000)
  })

  it('throws INVALID_AMOUNT for amount = 0', async () => {
    const deps = makeDeps()

    await expect(topUpWallet(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', amountCzk: 0 },
      deps,
    )).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
  })

  it('throws INVALID_AMOUNT for negative amount', async () => {
    const deps = makeDeps()

    await expect(topUpWallet(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', amountCzk: -500 },
      deps,
    )).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
  })

  it('throws RFID_NOT_REGISTERED when wallet not found', async () => {
    const db = makeDb({
      transaction: vi.fn(async (fn) => {
        const txDb: DbAdapter = {
          query: vi.fn(async () => []),
          execute: vi.fn(async () => undefined),
          transaction: vi.fn(),
        }
        return fn(txDb)
      }),
    })
    const deps: ServiceDeps = { db }

    await expect(topUpWallet(
      { rfidUid: 'RFID-UNKNOWN', eventId: 'event-1', amountCzk: 10000 },
      deps,
    )).rejects.toMatchObject({ code: 'RFID_NOT_REGISTERED' })
  })
})

// ── processVendorPurchase ──────────────────────────────────────────────────

describe('processVendorPurchase', () => {
  function makeTransactionalDb(wallet: CashlessWallet | null, vendor: Vendor | null, resultTx: CashlessTransaction): DbAdapter {
    let selectCount = 0
    const db = makeDb({
      transaction: vi.fn(async (fn) => {
        const txDb: DbAdapter = {
          query: vi.fn(async (sql: string) => {
            selectCount++
            if (selectCount === 1) return wallet ? [wallet] : []
            if (selectCount === 2) return vendor ? [vendor] : []
            return [resultTx]
          }),
          execute: vi.fn(async () => undefined),
          transaction: vi.fn(),
        }
        return fn(txDb)
      }),
    })
    return db
  }

  it('debits wallet balance and inserts purchase transaction', async () => {
    const wallet = makeWallet({ balanceCzk: 50000 })
    const vendor = makeVendor()
    const tx = makeTransaction({ type: 'purchase', amountCzk: -8000, balanceAfterCzk: 42000, vendorId: 'vendor-1' })

    const db = makeTransactionalDb(wallet, vendor, tx)
    const deps: ServiceDeps = { db }

    const result = await processVendorPurchase(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', vendorId: 'vendor-1', terminalId: 'terminal-1', amountCzk: 8000, description: 'Pivo 0.5l' },
      deps,
    )

    expect(db.transaction).toHaveBeenCalledOnce()
    expect(result.type).toBe('purchase')
    expect(result.amountCzk).toBe(-8000)
  })

  it('throws INSUFFICIENT_BALANCE when balance is too low', async () => {
    const wallet = makeWallet({ balanceCzk: 500 })
    const vendor = makeVendor()
    const tx = makeTransaction()

    const db = makeTransactionalDb(wallet, vendor, tx)
    const deps: ServiceDeps = { db }

    await expect(processVendorPurchase(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', vendorId: 'vendor-1', terminalId: 'terminal-1', amountCzk: 8000, description: 'Pivo' },
      deps,
    )).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
  })

  it('throws WALLET_FROZEN when wallet is frozen', async () => {
    const wallet = makeWallet({ status: 'frozen' })
    const vendor = makeVendor()
    const tx = makeTransaction()

    const db = makeTransactionalDb(wallet, vendor, tx)
    const deps: ServiceDeps = { db }

    await expect(processVendorPurchase(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', vendorId: 'vendor-1', terminalId: 'terminal-1', amountCzk: 100, description: 'Test' },
      deps,
    )).rejects.toMatchObject({ code: 'WALLET_FROZEN' })
  })

  it('throws VENDOR_NOT_FOUND when vendor does not exist', async () => {
    const wallet = makeWallet({ balanceCzk: 50000 })
    const tx = makeTransaction()

    const db = makeTransactionalDb(wallet, null, tx)
    const deps: ServiceDeps = { db }

    await expect(processVendorPurchase(
      { rfidUid: 'RFID-AAA', eventId: 'event-1', vendorId: 'vendor-ghost', terminalId: 'terminal-1', amountCzk: 100, description: 'Test' },
      deps,
    )).rejects.toMatchObject({ code: 'VENDOR_NOT_FOUND' })
  })

  it('throws RFID_NOT_REGISTERED when wallet not found', async () => {
    const tx = makeTransaction()
    const db = makeTransactionalDb(null, null, tx)
    const deps: ServiceDeps = { db }

    await expect(processVendorPurchase(
      { rfidUid: 'RFID-GHOST', eventId: 'event-1', vendorId: 'vendor-1', terminalId: 'terminal-1', amountCzk: 100, description: 'Test' },
      deps,
    )).rejects.toMatchObject({ code: 'RFID_NOT_REGISTERED' })
  })
})

// ── refundToWallet ─────────────────────────────────────────────────────────

describe('refundToWallet', () => {
  it('credits the wallet and inserts a refund transaction', async () => {
    const wallet = makeWallet({ balanceCzk: 42000 })
    const tx = makeTransaction({ type: 'refund', amountCzk: 8000, balanceAfterCzk: 50000 })

    let selectCount = 0
    const db = makeDb({
      transaction: vi.fn(async (fn) => {
        const txDb: DbAdapter = {
          query: vi.fn(async () => {
            selectCount++
            if (selectCount === 1) return [wallet]
            return [tx]
          }),
          execute: vi.fn(async () => undefined),
          transaction: vi.fn(),
        }
        return fn(txDb)
      }),
    })
    const deps: ServiceDeps = { db }

    const result = await refundToWallet('wallet-1', 8000, 'vendor-1', 'Refund for order', deps)

    expect(db.transaction).toHaveBeenCalledOnce()
    expect(result.type).toBe('refund')
    expect(result.amountCzk).toBe(8000)
  })

  it('throws WALLET_NOT_FOUND when wallet does not exist', async () => {
    const db = makeDb({
      transaction: vi.fn(async (fn) => {
        const txDb: DbAdapter = {
          query: vi.fn(async () => []),
          execute: vi.fn(async () => undefined),
          transaction: vi.fn(),
        }
        return fn(txDb)
      }),
    })
    const deps: ServiceDeps = { db }

    await expect(refundToWallet('wallet-ghost', 100, null, 'Refund', deps)).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    })
  })
})

// ── freezeWallet ───────────────────────────────────────────────────────────

describe('freezeWallet', () => {
  it('sets wallet status to frozen', async () => {
    const wallet = makeWallet({ status: 'active' })
    const db = makeDb({
      query: vi.fn(async () => [wallet]),
    })
    const deps: ServiceDeps = { db }

    const result = await freezeWallet('wallet-1', deps)

    expect(db.execute).toHaveBeenCalledOnce()
    const updateCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(updateCall[0]).toContain('frozen')
    expect(result.status).toBe('frozen')
  })

  it('throws WALLET_NOT_FOUND when wallet does not exist', async () => {
    const db = makeDb({
      query: vi.fn(async () => []),
    })
    const deps: ServiceDeps = { db }

    await expect(freezeWallet('wallet-ghost', deps)).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    })
  })
})

// ── closeEvent ─────────────────────────────────────────────────────────────

describe('closeEvent', () => {
  it('closes all wallets and returns total unspent balance', async () => {
    const w1 = makeWallet({ id: 'w1', balanceCzk: 10000 })
    const w2 = makeWallet({ id: 'w2', balanceCzk: 5000 })
    const db = makeDb({
      query: vi.fn(async () => [w1, w2]),
    })
    const deps: ServiceDeps = { db }

    const unspent = await closeEvent('event-1', deps)

    expect(db.execute).toHaveBeenCalledOnce()
    const updateSql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(updateSql).toContain('closed')
    expect(unspent).toBe(15000)
  })

  it('returns 0 when all wallets already spent everything', async () => {
    const w1 = makeWallet({ balanceCzk: 0 })
    const db = makeDb({
      query: vi.fn(async () => [w1]),
    })
    const deps: ServiceDeps = { db }

    const unspent = await closeEvent('event-1', deps)

    expect(unspent).toBe(0)
  })
})

// ── getWalletBalance ───────────────────────────────────────────────────────

describe('getWalletBalance', () => {
  it('returns balance info for registered RFID', async () => {
    const wallet = makeWallet({ balanceCzk: 30000, status: 'active' })
    const db = makeDb({
      query: vi.fn(async () => [wallet]),
    })
    const deps: ServiceDeps = { db }

    const result = await getWalletBalance('RFID-AAA', 'event-1', deps)

    expect(result.balanceCzk).toBe(30000)
    expect(result.walletId).toBe('wallet-1')
    expect(result.status).toBe('active')
  })

  it('throws RFID_NOT_REGISTERED for unknown RFID', async () => {
    const db = makeDb({
      query: vi.fn(async () => []),
    })
    const deps: ServiceDeps = { db }

    await expect(getWalletBalance('RFID-UNKNOWN', 'event-1', deps)).rejects.toMatchObject({
      code: 'RFID_NOT_REGISTERED',
    })
  })
})

// ── getTransactionHistory ──────────────────────────────────────────────────

describe('getTransactionHistory', () => {
  it('returns transactions ordered descending by occurredAt', async () => {
    const tx1 = makeTransaction({ id: 'tx-1', occurredAt: new Date('2026-04-01T12:00:00Z') })
    const tx2 = makeTransaction({ id: 'tx-2', occurredAt: new Date('2026-04-01T13:00:00Z') })
    const tx3 = makeTransaction({ id: 'tx-3', occurredAt: new Date('2026-04-01T11:00:00Z') })

    // DB returns already ordered (ORDER BY occurred_at DESC) — newest first
    const db = makeDb({
      query: vi.fn(async () => [tx2, tx1, tx3]),
    })
    const deps: ServiceDeps = { db }

    const result = await getTransactionHistory('wallet-1', deps)

    expect(result).toHaveLength(3)
    // The query includes ORDER BY DESC; we trust the mock returns correct order
    expect(result[0]!.id).toBe('tx-2')
    expect(result[1]!.id).toBe('tx-1')
    expect(result[2]!.id).toBe('tx-3')
  })

  it('returns empty array when no transactions exist', async () => {
    const db = makeDb({
      query: vi.fn(async () => []),
    })
    const deps: ServiceDeps = { db }

    const result = await getTransactionHistory('wallet-empty', deps)

    expect(result).toHaveLength(0)
  })
})

// ── getEventStats ──────────────────────────────────────────────────────────

describe('getEventStats', () => {
  it('calculates correct totals and top vendors', async () => {
    const wallets = [
      makeWallet({ id: 'w1', balanceCzk: 5000 }),
      makeWallet({ id: 'w2', balanceCzk: 3000 }),
    ]

    const transactions: CashlessTransaction[] = [
      makeTransaction({ id: 'tx-1', walletId: 'w1', type: 'top_up', amountCzk: 50000, balanceAfterCzk: 50000, vendorId: null }),
      makeTransaction({ id: 'tx-2', walletId: 'w2', type: 'top_up', amountCzk: 30000, balanceAfterCzk: 30000, vendorId: null }),
      makeTransaction({ id: 'tx-3', walletId: 'w1', type: 'purchase', amountCzk: -25000, balanceAfterCzk: 25000, vendorId: 'vendor-1' }),
      makeTransaction({ id: 'tx-4', walletId: 'w2', type: 'purchase', amountCzk: -12000, balanceAfterCzk: 18000, vendorId: 'vendor-2' }),
      makeTransaction({ id: 'tx-5', walletId: 'w1', type: 'purchase', amountCzk: -20000, balanceAfterCzk: 5000, vendorId: 'vendor-1' }),
    ]

    const vendors = [
      makeVendor({ id: 'vendor-1', name: 'Beer Stand' }),
      makeVendor({ id: 'vendor-2', name: 'Merch Shop' }),
    ]

    let queryCount = 0
    const db = makeDb({
      query: vi.fn(async (sql: string) => {
        queryCount++
        if (queryCount === 1) return wallets      // wallets query
        if (queryCount === 2) return transactions // transactions query
        return vendors                             // vendor names query
      }),
    })
    const deps: ServiceDeps = { db }

    const stats = await getEventStats('event-1', deps)

    expect(stats.totalWallets).toBe(2)
    expect(stats.totalTopUpCzk).toBe(80000)
    expect(stats.totalSpentCzk).toBe(57000)
    expect(stats.totalUnspentCzk).toBe(8000) // sum of current balances
    expect(stats.topVendors[0]!.vendorId).toBe('vendor-1')
    expect(stats.topVendors[0]!.revenueCzk).toBe(45000)
    expect(stats.topVendors[1]!.vendorId).toBe('vendor-2')
    expect(stats.topVendors[1]!.revenueCzk).toBe(12000)
    expect(stats.averageSpendPerAttendee).toBe(Math.round(57000 / 2))
  })

  it('returns zeroes when event has no wallets', async () => {
    let queryCount = 0
    const db = makeDb({
      query: vi.fn(async () => {
        queryCount++
        return []
      }),
    })
    const deps: ServiceDeps = { db }

    const stats = await getEventStats('event-empty', deps)

    expect(stats.totalWallets).toBe(0)
    expect(stats.totalTopUpCzk).toBe(0)
    expect(stats.totalSpentCzk).toBe(0)
    expect(stats.totalUnspentCzk).toBe(0)
    expect(stats.topVendors).toHaveLength(0)
    expect(stats.averageSpendPerAttendee).toBe(0)
  })
})
