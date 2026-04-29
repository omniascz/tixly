import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  requestMint,
  mintNft,
  getNftTicket,
  getNftTicketByTicketId,
  listNftTicketsForUser,
  transferNft,
  burnNft,
  buildMetadata,
} from '../services/nft-ticket.service';
import {
  NftTicketNotFoundError,
  NftAlreadyMintedError,
  NftMintFailedError,
  NftTransferNotAllowedError,
} from '../lib/types';

// ─── Mocks ───────────────────────────────────────────────────

const mockDb = {
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn((cb: (db: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
};

const mockStorage = {
  uploadMetadata: vi.fn(),
};

const mockBlockchain = {
  mint: vi.fn(),
  transfer: vi.fn(),
  contractAddress: vi.fn(() => '0xContractAddress'),
};

const deps = { db: mockDb, storage: mockStorage, blockchain: mockBlockchain, defaultChain: 'flow' };

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.transaction.mockImplementation((cb: (db: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  mockBlockchain.contractAddress.mockReturnValue('0xContractAddress');
});

// ─── Fixtures ────────────────────────────────────────────────

const nftRow = {
  id: 'nft-1',
  ticket_id: 'ticket-1',
  user_id: 'user-1',
  event_id: 'event-1',
  chain: 'flow',
  contract_address: '0xContractAddress',
  token_id: null,
  mint_status: 'pending',
  metadata_uri: null,
  owner_wallet: '0xUserWallet',
  mint_tx_hash: null,
  error_message: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

const mintedNftRow = {
  ...nftRow,
  token_id: '42',
  mint_status: 'minted',
  metadata_uri: 'ipfs://Qm123',
  mint_tx_hash: '0xTxHash',
};

const metadata = buildMetadata({
  ticketId: 'ticket-1',
  eventId: 'event-1',
  eventName: 'Rock Festival 2026',
  eventDate: '2026-07-15',
  venue: 'O2 Arena Praha',
  imageUrl: 'https://cdn.tixly.cz/events/event-1.png',
  externalUrl: 'https://tixly.cz/events/event-1',
});

// ─── requestMint ─────────────────────────────────────────────

describe('requestMint', () => {
  it('creates pending NFT record for new ticket', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null); // no existing
    mockDb.query.mockResolvedValueOnce([nftRow]);

    const nft = await requestMint(deps, {
      ticketId: 'ticket-1',
      userId: 'user-1',
      eventId: 'event-1',
      ownerWallet: '0xUserWallet',
      metadata,
    });

    expect(nft.mintStatus).toBe('pending');
    expect(nft.ticketId).toBe('ticket-1');
    expect(mockBlockchain.contractAddress).toHaveBeenCalledWith('flow');
  });

  it('is idempotent — returns existing record on second call', async () => {
    mockDb.queryOne.mockResolvedValueOnce(nftRow);

    const nft = await requestMint(deps, {
      ticketId: 'ticket-1',
      userId: 'user-1',
      eventId: 'event-1',
      ownerWallet: '0xUserWallet',
      metadata,
    });

    expect(nft.id).toBe('nft-1');
    expect(mockDb.query).not.toHaveBeenCalled();
  });
});

// ─── mintNft ─────────────────────────────────────────────────

describe('mintNft', () => {
  it('uploads metadata, mints on chain, updates DB', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce(nftRow)       // initial SELECT
      .mockResolvedValueOnce(mintedNftRow); // UPDATE RETURNING
    mockDb.execute.mockResolvedValueOnce({ rowCount: 1 }); // mark minting
    mockStorage.uploadMetadata.mockResolvedValueOnce('ipfs://Qm123');
    mockBlockchain.mint.mockResolvedValueOnce({ txHash: '0xTxHash', tokenId: '42' });

    const nft = await mintNft(deps, 'nft-1', metadata);

    expect(nft.mintStatus).toBe('minted');
    expect(nft.tokenId).toBe('42');
    expect(nft.mintTxHash).toBe('0xTxHash');
    expect(mockStorage.uploadMetadata).toHaveBeenCalledWith(metadata);
  });

  it('throws NftTicketNotFoundError for unknown id', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    await expect(mintNft(deps, 'missing', metadata)).rejects.toThrow(NftTicketNotFoundError);
  });

  it('throws NftAlreadyMintedError when already minted', async () => {
    mockDb.queryOne.mockResolvedValueOnce(mintedNftRow);

    await expect(mintNft(deps, 'nft-1', metadata)).rejects.toThrow(NftAlreadyMintedError);
  });

  it('marks as failed and throws NftMintFailedError on blockchain error', async () => {
    mockDb.queryOne.mockResolvedValueOnce(nftRow);
    mockDb.execute
      .mockResolvedValueOnce({ rowCount: 1 }) // mark minting
      .mockResolvedValueOnce({ rowCount: 1 }); // mark failed
    mockStorage.uploadMetadata.mockResolvedValueOnce('ipfs://Qm123');
    mockBlockchain.mint.mockRejectedValueOnce(new Error('out of gas'));

    await expect(mintNft(deps, 'nft-1', metadata)).rejects.toThrow(NftMintFailedError);
    expect(mockDb.execute).toHaveBeenCalledTimes(2); // minting + failed
  });
});

// ─── getNftTicket ─────────────────────────────────────────────

describe('getNftTicket', () => {
  it('returns NFT ticket by id', async () => {
    mockDb.queryOne.mockResolvedValueOnce(nftRow);
    const nft = await getNftTicket('nft-1', mockDb);
    expect(nft.id).toBe('nft-1');
  });

  it('throws NftTicketNotFoundError for unknown id', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);
    await expect(getNftTicket('missing', mockDb)).rejects.toThrow(NftTicketNotFoundError);
  });
});

// ─── getNftTicketByTicketId ───────────────────────────────────

describe('getNftTicketByTicketId', () => {
  it('returns null when no NFT for ticket', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);
    const result = await getNftTicketByTicketId('ticket-99', mockDb);
    expect(result).toBeNull();
  });
});

// ─── listNftTicketsForUser ────────────────────────────────────

describe('listNftTicketsForUser', () => {
  it('returns NFTs for user', async () => {
    mockDb.query.mockResolvedValueOnce([nftRow]);
    const nfts = await listNftTicketsForUser('user-1', mockDb);
    expect(nfts).toHaveLength(1);
  });
});

// ─── transferNft ─────────────────────────────────────────────

describe('transferNft', () => {
  it('records and completes on-chain transfer', async () => {
    mockDb.queryOne.mockResolvedValueOnce(mintedNftRow);
    mockDb.query.mockResolvedValueOnce([{
      id: 'transfer-1',
      nft_ticket_id: 'nft-1',
      from_wallet: '0xUserWallet',
      to_wallet: '0xFriendWallet',
      tx_hash: null,
      status: 'pending',
      initiated_at: '2026-04-21T00:00:00Z',
      completed_at: null,
    }]);
    mockDb.execute
      .mockResolvedValueOnce({ rowCount: 1 }) // update transfer
      .mockResolvedValueOnce({ rowCount: 1 }); // update nft owner
    mockBlockchain.transfer.mockResolvedValueOnce({ txHash: '0xTransferHash' });

    const transfer = await transferNft(deps, {
      nftTicketId: 'nft-1',
      fromWallet: '0xUserWallet',
      toWallet: '0xFriendWallet',
    });

    expect(transfer.status).toBe('completed');
    expect(transfer.txHash).toBe('0xTransferHash');
  });

  it('throws NftTransferNotAllowedError when NFT is not yet minted', async () => {
    mockDb.queryOne.mockResolvedValueOnce(nftRow); // pending

    await expect(
      transferNft(deps, { nftTicketId: 'nft-1', fromWallet: '0xUserWallet', toWallet: '0xFriend' }),
    ).rejects.toThrow(NftTransferNotAllowedError);
  });

  it('throws NftTransferNotAllowedError when fromWallet is not owner', async () => {
    mockDb.queryOne.mockResolvedValueOnce(mintedNftRow);

    await expect(
      transferNft(deps, { nftTicketId: 'nft-1', fromWallet: '0xWrongWallet', toWallet: '0xFriend' }),
    ).rejects.toThrow(NftTransferNotAllowedError);
  });
});

// ─── burnNft ─────────────────────────────────────────────────

describe('burnNft', () => {
  it('marks minted NFT as burned', async () => {
    mockDb.execute.mockResolvedValueOnce({ rowCount: 1 });
    await expect(burnNft('nft-1', mockDb)).resolves.toBeUndefined();
  });

  it('throws NftTicketNotFoundError when NFT is not minted or not found', async () => {
    mockDb.execute.mockResolvedValueOnce({ rowCount: 0 });
    await expect(burnNft('missing', mockDb)).rejects.toThrow(NftTicketNotFoundError);
  });
});

// ─── buildMetadata ────────────────────────────────────────────

describe('buildMetadata', () => {
  it('constructs valid metadata with required fields', () => {
    expect(metadata.name).toContain('Rock Festival 2026');
    expect(metadata.tixly.ticketId).toBe('ticket-1');
    expect(metadata.attributes.some(a => a.trait_type === 'Akce')).toBe(true);
  });

  it('includes seat info when provided', () => {
    const withSeat = buildMetadata({
      ticketId: 'ticket-2',
      eventId: 'event-2',
      eventName: 'Test',
      eventDate: '2026-08-01',
      venue: 'Venue',
      imageUrl: 'https://cdn.tixly.cz/test.png',
      seatInfo: 'Řada 5, Sedadlo 12',
      externalUrl: 'https://tixly.cz',
    });
    expect(withSeat.attributes.some(a => a.trait_type === 'Sedadlo')).toBe(true);
  });
});
