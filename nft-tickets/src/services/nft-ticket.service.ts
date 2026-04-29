// nft-ticket.service.ts — Opt-in NFT collectible tickets
//
// Design: NFT is a collectible companion to the standard Tixly QR ticket.
// Standard ticket remains the access credential; NFT is a digital souvenir.
// Opt-in: user must explicitly request minting (e.g. checkbox at checkout).
// Chain-agnostic: blockchain and storage adapters are injected.

import type {
  DbAdapter,
  StorageAdapter,
  BlockchainAdapter,
  NftTicket,
  NftTransfer,
  MintNftOptions,
  TransferNftOptions,
  NftMetadata,
} from '../lib/types';
import {
  NftTicketNotFoundError,
  NftAlreadyMintedError,
  NftMintFailedError,
  NftTransferNotAllowedError,
} from '../lib/types';

// ─── Internal DB row types ────────────────────────────────────

interface NftTicketRow {
  id: string;
  ticket_id: string;
  user_id: string;
  event_id: string;
  chain: string;
  contract_address: string;
  token_id: string | null;
  mint_status: string;
  metadata_uri: string | null;
  owner_wallet: string | null;
  mint_tx_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface NftTransferRow {
  id: string;
  nft_ticket_id: string;
  from_wallet: string;
  to_wallet: string;
  tx_hash: string | null;
  status: string;
  initiated_at: string;
  completed_at: string | null;
}

// ─── Mappers ─────────────────────────────────────────────────

function mapNftTicket(row: NftTicketRow): NftTicket {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    userId: row.user_id,
    eventId: row.event_id,
    chain: row.chain,
    contractAddress: row.contract_address,
    tokenId: row.token_id ?? undefined,
    mintStatus: row.mint_status as NftTicket['mintStatus'],
    metadataUri: row.metadata_uri ?? undefined,
    ownerWallet: row.owner_wallet ?? undefined,
    mintTxHash: row.mint_tx_hash ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapTransfer(row: NftTransferRow): NftTransfer {
  return {
    id: row.id,
    nftTicketId: row.nft_ticket_id,
    fromWallet: row.from_wallet,
    toWallet: row.to_wallet,
    txHash: row.tx_hash ?? undefined,
    status: row.status as NftTransfer['status'],
    initiatedAt: new Date(row.initiated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

// ─── Service deps ─────────────────────────────────────────────

export interface NftServiceDeps {
  db: DbAdapter;
  storage: StorageAdapter;
  blockchain: BlockchainAdapter;
  /** Default chain for minting; can be overridden per-request */
  defaultChain?: string;
}

// ─── requestMint ──────────────────────────────────────────────

/**
 * User opts-in to NFT for their ticket. Creates a pending NFT record.
 * Actual minting is async (call mintNft separately, e.g. from a job).
 * Idempotent: second call for same ticketId returns existing record.
 */
export async function requestMint(
  deps: NftServiceDeps,
  opts: MintNftOptions,
): Promise<NftTicket> {
  const chain = opts.chain ?? deps.defaultChain ?? 'flow';
  const contractAddress = deps.blockchain.contractAddress(chain);

  return deps.db.transaction(async (tx) => {
    const existing = await tx.queryOne<NftTicketRow>(
      `SELECT * FROM nft.tickets WHERE ticket_id = $1`,
      [opts.ticketId],
    );
    if (existing) return mapNftTicket(existing);

    const rows = await tx.query<NftTicketRow>(
      `INSERT INTO nft.tickets
         (ticket_id, user_id, event_id, chain, contract_address, owner_wallet,
          mint_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())
       RETURNING *`,
      [opts.ticketId, opts.userId, opts.eventId, chain, contractAddress, opts.ownerWallet],
    );

    return mapNftTicket(rows[0]);
  });
}

// ─── mintNft ─────────────────────────────────────────────────

/**
 * Execute the actual on-chain mint for a pending NFT ticket.
 * Called by async job or webhook after payment confirmation.
 * Updates status to 'minting', then 'minted' or 'failed'.
 */
export async function mintNft(
  deps: NftServiceDeps,
  nftTicketId: string,
  metadata: NftMetadata,
): Promise<NftTicket> {
  const row = await deps.db.queryOne<NftTicketRow>(
    `SELECT * FROM nft.tickets WHERE id = $1`,
    [nftTicketId],
  );
  if (!row) throw new NftTicketNotFoundError(nftTicketId);

  const nft = mapNftTicket(row);
  if (nft.mintStatus === 'minted') throw new NftAlreadyMintedError(nft.ticketId);

  // Mark as minting
  await deps.db.execute(
    `UPDATE nft.tickets SET mint_status = 'minting', updated_at = NOW() WHERE id = $1`,
    [nftTicketId],
  );

  try {
    const metadataUri = await deps.storage.uploadMetadata(metadata);
    const { txHash, tokenId } = await deps.blockchain.mint({
      contractAddress: nft.contractAddress,
      toWallet: nft.ownerWallet!,
      metadataUri,
    });

    const updated = await deps.db.queryOne<NftTicketRow>(
      `UPDATE nft.tickets
       SET mint_status = 'minted', token_id = $1, metadata_uri = $2,
           mint_tx_hash = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [tokenId, metadataUri, txHash, nftTicketId],
    );

    return mapNftTicket(updated!);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await deps.db.execute(
      `UPDATE nft.tickets SET mint_status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [errorMessage, nftTicketId],
    );
    throw new NftMintFailedError(errorMessage);
  }
}

// ─── getNftTicket ─────────────────────────────────────────────

export async function getNftTicket(nftTicketId: string, db: DbAdapter): Promise<NftTicket> {
  const row = await db.queryOne<NftTicketRow>(
    `SELECT * FROM nft.tickets WHERE id = $1`,
    [nftTicketId],
  );
  if (!row) throw new NftTicketNotFoundError(nftTicketId);
  return mapNftTicket(row);
}

// ─── getNftTicketByTicketId ───────────────────────────────────

export async function getNftTicketByTicketId(
  ticketId: string,
  db: DbAdapter,
): Promise<NftTicket | null> {
  const row = await db.queryOne<NftTicketRow>(
    `SELECT * FROM nft.tickets WHERE ticket_id = $1`,
    [ticketId],
  );
  return row ? mapNftTicket(row) : null;
}

// ─── listNftTicketsForUser ────────────────────────────────────

export async function listNftTicketsForUser(userId: string, db: DbAdapter): Promise<NftTicket[]> {
  const rows = await db.query<NftTicketRow>(
    `SELECT * FROM nft.tickets WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapNftTicket);
}

// ─── transferNft ─────────────────────────────────────────────

/**
 * Transfer a minted NFT to a new wallet (gift or resale-adjacent collectible).
 * Only collectible transfers — actual ticket access stays with original buyer.
 */
export async function transferNft(
  deps: NftServiceDeps,
  opts: TransferNftOptions,
): Promise<NftTransfer> {
  return deps.db.transaction(async (tx) => {
    const row = await tx.queryOne<NftTicketRow>(
      `SELECT * FROM nft.tickets WHERE id = $1`,
      [opts.nftTicketId],
    );
    if (!row) throw new NftTicketNotFoundError(opts.nftTicketId);

    const nft = mapNftTicket(row);
    if (nft.mintStatus !== 'minted') {
      throw new NftTransferNotAllowedError(`NFT is not yet minted (status: ${nft.mintStatus})`);
    }
    if (nft.ownerWallet !== opts.fromWallet) {
      throw new NftTransferNotAllowedError('fromWallet does not match current owner');
    }

    // Record transfer as pending
    const transferRows = await tx.query<NftTransferRow>(
      `INSERT INTO nft.transfers
         (nft_ticket_id, from_wallet, to_wallet, status, initiated_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING *`,
      [opts.nftTicketId, opts.fromWallet, opts.toWallet],
    );
    const transfer = mapTransfer(transferRows[0]);

    try {
      const { txHash } = await deps.blockchain.transfer({
        contractAddress: nft.contractAddress,
        tokenId: nft.tokenId!,
        fromWallet: opts.fromWallet,
        toWallet: opts.toWallet,
      });

      // Update transfer and NFT owner
      await tx.execute(
        `UPDATE nft.transfers SET status = 'completed', tx_hash = $1, completed_at = NOW() WHERE id = $2`,
        [txHash, transfer.id],
      );
      await tx.execute(
        `UPDATE nft.tickets SET owner_wallet = $1, updated_at = NOW() WHERE id = $2`,
        [opts.toWallet, opts.nftTicketId],
      );

      return { ...transfer, status: 'completed', txHash, completedAt: new Date() };
    } catch (err) {
      await tx.execute(
        `UPDATE nft.transfers SET status = 'failed', completed_at = NOW() WHERE id = $1`,
        [transfer.id],
      );
      throw err;
    }
  });
}

// ─── burnNft ─────────────────────────────────────────────────

/**
 * Burn (invalidate) NFT when underlying ticket is refunded or cancelled.
 * Marks DB record as burned; actual on-chain burn is optional/chain-dependent.
 */
export async function burnNft(nftTicketId: string, db: DbAdapter): Promise<void> {
  const result = await db.execute(
    `UPDATE nft.tickets
     SET mint_status = 'burned', updated_at = NOW()
     WHERE id = $1 AND mint_status = 'minted'`,
    [nftTicketId],
  );
  if (result.rowCount === 0) {
    throw new NftTicketNotFoundError(nftTicketId);
  }
}

// ─── buildMetadata ────────────────────────────────────────────

/**
 * Helper: construct standard NftMetadata from event data.
 * Caller fills in event-specific strings from their data sources.
 */
export function buildMetadata(opts: {
  ticketId: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  imageUrl: string;
  seatInfo?: string;
  externalUrl: string;
}): NftMetadata {
  return {
    name: `${opts.eventName} — Vstupenka`,
    description: `Sběratelská NFT vstupenka na akci ${opts.eventName} (${opts.eventDate}).`,
    image: opts.imageUrl,
    external_url: opts.externalUrl,
    attributes: [
      { trait_type: 'Akce', value: opts.eventName },
      { trait_type: 'Datum', value: opts.eventDate },
      { trait_type: 'Místo konání', value: opts.venue },
      ...(opts.seatInfo ? [{ trait_type: 'Sedadlo', value: opts.seatInfo }] : []),
    ],
    tixly: {
      ticketId: opts.ticketId,
      eventId: opts.eventId,
      eventName: opts.eventName,
      eventDate: opts.eventDate,
      venue: opts.venue,
      seatInfo: opts.seatInfo,
    },
  };
}
