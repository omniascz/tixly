import {
  CashlessWallet,
  CashlessTransaction,
  Vendor,
  TopUpInput,
  PurchaseInput,
  EventCashlessStats,
  CashlessError,
  DbAdapter,
  ServiceDeps,
} from '../types/cashless.types'

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function registerWallet(
  rfidUid: string,
  eventId: string,
  attendeeId: string,
  deps: ServiceDeps,
): Promise<CashlessWallet> {
  const { db } = deps
  const now = new Date()
  const id = generateId()

  await db.execute(
    `INSERT INTO cashless_wallets (id, event_id, attendee_id, rfid_uid, balance_czk, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, eventId, attendeeId, rfidUid, 0, 'active', now, now],
  )

  const rows = await db.query<CashlessWallet>(
    `SELECT * FROM cashless_wallets WHERE id = $1`,
    [id],
  )

  const wallet = rows[0]
  if (!wallet) throw new CashlessError('WALLET_NOT_FOUND', 'Failed to retrieve newly created wallet')
  return wallet
}

export async function topUpWallet(
  input: TopUpInput,
  deps: ServiceDeps,
): Promise<CashlessTransaction> {
  const { db } = deps

  if (input.amountCzk <= 0) {
    throw new CashlessError('INVALID_AMOUNT', 'Top-up amount must be greater than zero')
  }

  return db.transaction(async (tx) => {
    const wallets = await tx.query<CashlessWallet>(
      `SELECT * FROM cashless_wallets WHERE rfid_uid = $1 AND event_id = $2 FOR UPDATE`,
      [input.rfidUid, input.eventId],
    )

    const wallet = wallets[0]
    if (!wallet) throw new CashlessError('RFID_NOT_REGISTERED', `RFID ${input.rfidUid} not registered for event ${input.eventId}`)

    const newBalance = wallet.balanceCzk + input.amountCzk
    const now = new Date()

    await tx.execute(
      `UPDATE cashless_wallets SET balance_czk = $1, updated_at = $2 WHERE id = $3`,
      [newBalance, now, wallet.id],
    )

    const txId = generateId()
    await tx.execute(
      `INSERT INTO cashless_transactions (id, wallet_id, vendor_id, type, amount_czk, balance_after_czk, description, terminal_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txId, wallet.id, null, 'top_up', input.amountCzk, newBalance, input.description ?? 'Top-up', null, now],
    )

    const txRows = await tx.query<CashlessTransaction>(
      `SELECT * FROM cashless_transactions WHERE id = $1`,
      [txId],
    )

    const transaction = txRows[0]
    if (!transaction) throw new CashlessError('WALLET_NOT_FOUND', 'Failed to retrieve transaction')
    return transaction
  })
}

export async function processVendorPurchase(
  input: PurchaseInput,
  deps: ServiceDeps,
): Promise<CashlessTransaction> {
  const { db } = deps

  if (input.amountCzk <= 0) {
    throw new CashlessError('INVALID_AMOUNT', 'Purchase amount must be greater than zero')
  }

  return db.transaction(async (tx) => {
    const wallets = await tx.query<CashlessWallet>(
      `SELECT * FROM cashless_wallets WHERE rfid_uid = $1 AND event_id = $2 FOR UPDATE`,
      [input.rfidUid, input.eventId],
    )

    const wallet = wallets[0]
    if (!wallet) throw new CashlessError('RFID_NOT_REGISTERED', `RFID ${input.rfidUid} not registered for event ${input.eventId}`)

    if (wallet.status === 'frozen') {
      throw new CashlessError('WALLET_FROZEN', `Wallet ${wallet.id} is frozen`)
    }

    if (wallet.status !== 'active') {
      throw new CashlessError('WALLET_FROZEN', `Wallet ${wallet.id} is not active`)
    }

    const vendors = await tx.query<Vendor>(
      `SELECT * FROM cashless_vendors WHERE id = $1 AND event_id = $2`,
      [input.vendorId, input.eventId],
    )

    const vendor = vendors[0]
    if (!vendor) throw new CashlessError('VENDOR_NOT_FOUND', `Vendor ${input.vendorId} not found`)

    if (wallet.balanceCzk < input.amountCzk) {
      throw new CashlessError(
        'INSUFFICIENT_BALANCE',
        `Insufficient balance: ${wallet.balanceCzk} haléřů available, ${input.amountCzk} required`,
      )
    }

    const newBalance = wallet.balanceCzk - input.amountCzk
    const now = new Date()

    await tx.execute(
      `UPDATE cashless_wallets SET balance_czk = $1, updated_at = $2 WHERE id = $3`,
      [newBalance, now, wallet.id],
    )

    const txId = generateId()
    await tx.execute(
      `INSERT INTO cashless_transactions (id, wallet_id, vendor_id, type, amount_czk, balance_after_czk, description, terminal_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txId, wallet.id, input.vendorId, 'purchase', -input.amountCzk, newBalance, input.description, input.terminalId, now],
    )

    const txRows = await tx.query<CashlessTransaction>(
      `SELECT * FROM cashless_transactions WHERE id = $1`,
      [txId],
    )

    const transaction = txRows[0]
    if (!transaction) throw new CashlessError('WALLET_NOT_FOUND', 'Failed to retrieve transaction')
    return transaction
  })
}

export async function refundToWallet(
  walletId: string,
  amountCzk: number,
  vendorId: string | null,
  description: string,
  deps: ServiceDeps,
): Promise<CashlessTransaction> {
  const { db } = deps

  return db.transaction(async (tx) => {
    const wallets = await tx.query<CashlessWallet>(
      `SELECT * FROM cashless_wallets WHERE id = $1 FOR UPDATE`,
      [walletId],
    )

    const wallet = wallets[0]
    if (!wallet) throw new CashlessError('WALLET_NOT_FOUND', `Wallet ${walletId} not found`)

    const newBalance = wallet.balanceCzk + amountCzk
    const now = new Date()

    await tx.execute(
      `UPDATE cashless_wallets SET balance_czk = $1, updated_at = $2 WHERE id = $3`,
      [newBalance, now, wallet.id],
    )

    const txId = generateId()
    await tx.execute(
      `INSERT INTO cashless_transactions (id, wallet_id, vendor_id, type, amount_czk, balance_after_czk, description, terminal_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txId, wallet.id, vendorId, 'refund', amountCzk, newBalance, description, null, now],
    )

    const txRows = await tx.query<CashlessTransaction>(
      `SELECT * FROM cashless_transactions WHERE id = $1`,
      [txId],
    )

    const transaction = txRows[0]
    if (!transaction) throw new CashlessError('WALLET_NOT_FOUND', 'Failed to retrieve transaction')
    return transaction
  })
}

export async function freezeWallet(
  walletId: string,
  deps: ServiceDeps,
): Promise<CashlessWallet> {
  const { db } = deps

  const wallets = await db.query<CashlessWallet>(
    `SELECT * FROM cashless_wallets WHERE id = $1`,
    [walletId],
  )

  const wallet = wallets[0]
  if (!wallet) throw new CashlessError('WALLET_NOT_FOUND', `Wallet ${walletId} not found`)

  const now = new Date()
  await db.execute(
    `UPDATE cashless_wallets SET status = 'frozen', updated_at = $1 WHERE id = $2`,
    [now, walletId],
  )

  return { ...wallet, status: 'frozen', updatedAt: now }
}

export async function closeEvent(
  eventId: string,
  deps: ServiceDeps,
): Promise<number> {
  const { db } = deps

  const wallets = await db.query<CashlessWallet>(
    `SELECT * FROM cashless_wallets WHERE event_id = $1 AND status != 'closed'`,
    [eventId],
  )

  const now = new Date()
  await db.execute(
    `UPDATE cashless_wallets SET status = 'closed', updated_at = $1 WHERE event_id = $2 AND status != 'closed'`,
    [now, eventId],
  )

  const totalUnspent = wallets.reduce((sum, w) => sum + w.balanceCzk, 0)
  return totalUnspent
}

export async function getWalletBalance(
  rfidUid: string,
  eventId: string,
  deps: ServiceDeps,
): Promise<{ balanceCzk: number; walletId: string; status: string }> {
  const { db } = deps

  const wallets = await db.query<CashlessWallet>(
    `SELECT * FROM cashless_wallets WHERE rfid_uid = $1 AND event_id = $2`,
    [rfidUid, eventId],
  )

  const wallet = wallets[0]
  if (!wallet) throw new CashlessError('RFID_NOT_REGISTERED', `RFID ${rfidUid} not registered for event ${eventId}`)

  return { balanceCzk: wallet.balanceCzk, walletId: wallet.id, status: wallet.status }
}

export async function getTransactionHistory(
  walletId: string,
  deps: ServiceDeps,
): Promise<CashlessTransaction[]> {
  const { db } = deps

  return db.query<CashlessTransaction>(
    `SELECT * FROM cashless_transactions WHERE wallet_id = $1 ORDER BY occurred_at DESC`,
    [walletId],
  )
}

export async function getEventStats(
  eventId: string,
  deps: ServiceDeps,
): Promise<EventCashlessStats> {
  const { db } = deps

  const wallets = await db.query<CashlessWallet>(
    `SELECT * FROM cashless_wallets WHERE event_id = $1`,
    [eventId],
  )

  const transactions = await db.query<CashlessTransaction & { wallet_event_id?: string }>(
    `SELECT t.* FROM cashless_transactions t
     JOIN cashless_wallets w ON w.id = t.wallet_id
     WHERE w.event_id = $1`,
    [eventId],
  )

  const totalWallets = wallets.length
  const totalUnspentCzk = wallets.reduce((sum, w) => sum + w.balanceCzk, 0)

  const totalTopUpCzk = transactions
    .filter((t) => t.type === 'top_up')
    .reduce((sum, t) => sum + t.amountCzk, 0)

  const totalSpentCzk = transactions
    .filter((t) => t.type === 'purchase')
    .reduce((sum, t) => sum + Math.abs(t.amountCzk), 0)

  // aggregate by vendor
  const vendorMap = new Map<string, number>()
  for (const t of transactions) {
    if (t.type === 'purchase' && t.vendorId !== null) {
      const current = vendorMap.get(t.vendorId) ?? 0
      vendorMap.set(t.vendorId, current + Math.abs(t.amountCzk))
    }
  }

  // fetch vendor names
  const vendorIds = [...vendorMap.keys()]
  const vendors = vendorIds.length > 0
    ? await db.query<Vendor>(`SELECT * FROM cashless_vendors WHERE id = ANY($1)`, [vendorIds])
    : []

  const vendorNameMap = new Map(vendors.map((v) => [v.id, v.name]))

  const topVendors = [...vendorMap.entries()]
    .map(([vendorId, revenueCzk]) => ({
      vendorId,
      name: vendorNameMap.get(vendorId) ?? vendorId,
      revenueCzk,
    }))
    .sort((a, b) => b.revenueCzk - a.revenueCzk)

  const averageSpendPerAttendee = totalWallets > 0
    ? Math.round(totalSpentCzk / totalWallets)
    : 0

  return {
    eventId,
    totalWallets,
    totalTopUpCzk,
    totalSpentCzk,
    totalUnspentCzk,
    topVendors,
    averageSpendPerAttendee,
  }
}
