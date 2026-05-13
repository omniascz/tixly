// ============================================================
// NFT Tickets — Type Definitions
// Opt-in collectible NFT alongside standard QR ticket.
// Chain-agnostic: actual minting delegated to blockchain adapter.
// ============================================================

export type NftMintStatus = 'pending' | 'minting' | 'minted' | 'failed' | 'burned';
export type NftTransferStatus = 'pending' | 'completed' | 'failed';

// ─── NFT Ticket record (stored in DB) ────────────────────────

export interface NftTicket {
  id: string;
  /** The canonical Tixly ticket id this NFT represents */
  ticketId: string;
  userId: string;
  eventId: string;
  /** Blockchain network (e.g. "flow", "polygon", "solana") */
  chain: string;
  /** NFT contract address on chain */
  contractAddress: string;
  /** Token ID on chain; undefined until minted */
  tokenId?: string;
  mintStatus: NftMintStatus;
  /** IPFS/Arweave URI of metadata JSON */
  metadataUri?: string;
  /** Wallet address that owns this NFT */
  ownerWallet?: string;
  mintTxHash?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── NFT Metadata (stored on IPFS) ──────────────────────────

export interface NftMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
  external_url: string;
  /** Tixly-specific extension */
  tixly: {
    ticketId: string;
    eventId: string;
    eventName: string;
    eventDate: string;
    venue: string;
    seatInfo?: string;
  };
}

// ─── Transfer record ─────────────────────────────────────────

export interface NftTransfer {
  id: string;
  nftTicketId: string;
  fromWallet: string;
  toWallet: string;
  txHash?: string;
  status: NftTransferStatus;
  initiatedAt: Date;
  completedAt?: Date;
}

// ─── Commands ────────────────────────────────────────────────

export interface MintNftOptions {
  ticketId: string;
  userId: string;
  eventId: string;
  ownerWallet: string;
  metadata: NftMetadata;
  chain?: string;
}

export interface TransferNftOptions {
  nftTicketId: string;
  fromWallet: string;
  toWallet: string;
}

// ─── Adapters (injected, chain-agnostic) ─────────────────────

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface StorageAdapter {
  /** Upload metadata JSON; returns public URI (IPFS CID URL or Arweave URL) */
  uploadMetadata(metadata: NftMetadata): Promise<string>;
}

export interface BlockchainAdapter {
  /** Mint NFT; returns tx hash */
  mint(opts: {
    contractAddress: string;
    toWallet: string;
    metadataUri: string;
  }): Promise<{ txHash: string; tokenId: string }>;

  /** Transfer NFT; returns tx hash */
  transfer(opts: {
    contractAddress: string;
    tokenId: string;
    fromWallet: string;
    toWallet: string;
  }): Promise<{ txHash: string }>;

  /** Get contract address for given chain */
  contractAddress(chain: string): string;
}

// ─── Errors ──────────────────────────────────────────────────

export class NftTicketNotFoundError extends Error {
  constructor(id: string) {
    super(`NFT ticket not found: ${id}`);
    this.name = 'NftTicketNotFoundError';
  }
}

export class NftAlreadyMintedError extends Error {
  constructor(ticketId: string) {
    super(`NFT already minted for ticket: ${ticketId}`);
    this.name = 'NftAlreadyMintedError';
  }
}

export class NftMintFailedError extends Error {
  constructor(message: string) {
    super(`NFT mint failed: ${message}`);
    this.name = 'NftMintFailedError';
  }
}

export class NftTransferNotAllowedError extends Error {
  constructor(reason: string) {
    super(`NFT transfer not allowed: ${reason}`);
    this.name = 'NftTransferNotAllowedError';
  }
}
