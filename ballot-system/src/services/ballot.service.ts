import {
  Ballot,
  BallotEntry,
  BallotInput,
  DrawResult,
  BallotError,
  ServiceDeps,
} from '../types/ballot.types.js';

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = temp;
  }
  return result;
}

export async function createBallot(
  input: BallotInput,
  deps: ServiceDeps,
): Promise<Ballot> {
  const id = crypto.randomUUID();
  const now = new Date();
  const purchaseWindowHours = input.purchaseWindowHours ?? 48;

  await deps.db.execute(
    `INSERT INTO ballots (id, event_id, organizer_id, name, total_slots, registration_opens_at, registration_closes_at, purchase_window_hours, status, drawn_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', NULL, $9)`,
    [
      id,
      input.eventId,
      input.organizerId,
      input.name,
      input.totalSlots,
      input.registrationOpensAt,
      input.registrationClosesAt,
      purchaseWindowHours,
      now,
    ],
  );

  const rows = await deps.db.query<Ballot>(
    `SELECT * FROM ballots WHERE id = $1`,
    [id],
  );

  const row = rows[0];
  if (!row) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found after insert: ${id}`);
  return row;
}

export async function openRegistration(
  ballotId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<Ballot> {
  const rows = await deps.db.query<Ballot>(
    `SELECT * FROM ballots WHERE id = $1 AND organizer_id = $2`,
    [ballotId, organizerId],
  );

  const ballot = rows[0];
  if (!ballot) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found: ${ballotId}`);
  if (ballot.status !== 'draft') {
    throw new BallotError('REGISTRATION_NOT_OPEN', `Ballot must be in draft status to open registration, current status: ${ballot.status}`);
  }

  await deps.db.execute(
    `UPDATE ballots SET status = 'open' WHERE id = $1`,
    [ballotId],
  );

  const updated = await deps.db.query<Ballot>(
    `SELECT * FROM ballots WHERE id = $1`,
    [ballotId],
  );

  const updatedRow = updated[0];
  if (!updatedRow) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found after update: ${ballotId}`);
  return updatedRow;
}

export async function closeRegistration(
  ballotId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<Ballot> {
  const rows = await deps.db.query<Ballot>(
    `SELECT * FROM ballots WHERE id = $1 AND organizer_id = $2`,
    [ballotId, organizerId],
  );

  const ballot = rows[0];
  if (!ballot) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found: ${ballotId}`);
  if (ballot.status !== 'open') {
    throw new BallotError('REGISTRATION_NOT_OPEN', `Ballot must be open to close registration, current status: ${ballot.status}`);
  }

  await deps.db.execute(
    `UPDATE ballots SET status = 'closed' WHERE id = $1`,
    [ballotId],
  );

  const updated = await deps.db.query<Ballot>(
    `SELECT * FROM ballots WHERE id = $1`,
    [ballotId],
  );

  const updatedRow = updated[0];
  if (!updatedRow) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found after update: ${ballotId}`);
  return updatedRow;
}

export async function registerForBallot(
  ballotId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<BallotEntry> {
  const ballotRows = await deps.db.query<Ballot>(
    `SELECT * FROM ballots WHERE id = $1`,
    [ballotId],
  );

  const ballot = ballotRows[0];
  if (!ballot) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found: ${ballotId}`);
  if (ballot.status !== 'open') {
    throw new BallotError('REGISTRATION_NOT_OPEN', `Ballot is not open for registration, current status: ${ballot.status}`);
  }

  const existingRows = await deps.db.query<BallotEntry>(
    `SELECT * FROM ballot_entries WHERE ballot_id = $1 AND user_id = $2`,
    [ballotId, userId],
  );

  if (existingRows[0]) {
    throw new BallotError('ALREADY_REGISTERED', `User ${userId} is already registered for ballot ${ballotId}`);
  }

  const entryId = crypto.randomUUID();
  const now = new Date();

  await deps.db.execute(
    `INSERT INTO ballot_entries (id, ballot_id, user_id, status, rank, purchase_deadline_at, registered_at, updated_at)
     VALUES ($1, $2, $3, 'registered', NULL, NULL, $4, $5)`,
    [entryId, ballotId, userId, now, now],
  );

  const entryRows = await deps.db.query<BallotEntry>(
    `SELECT * FROM ballot_entries WHERE id = $1`,
    [entryId],
  );

  const entry = entryRows[0];
  if (!entry) throw new BallotError('ENTRY_NOT_FOUND', `Entry not found after insert: ${entryId}`);
  return entry;
}

export async function conductDraw(
  ballotId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<DrawResult> {
  return deps.db.transaction(async (tx) => {
    const ballotRows = await tx.query<Ballot>(
      `SELECT * FROM ballots WHERE id = $1 AND organizer_id = $2`,
      [ballotId, organizerId],
    );

    const ballot = ballotRows[0];
    if (!ballot) throw new BallotError('BALLOT_NOT_FOUND', `Ballot not found: ${ballotId}`);
    if (ballot.status === 'drawn') {
      throw new BallotError('BALLOT_ALREADY_DRAWN', `Ballot has already been drawn: ${ballotId}`);
    }
    if (ballot.status !== 'closed') {
      throw new BallotError('BALLOT_NOT_CLOSED', `Ballot must be closed to conduct draw, current status: ${ballot.status}`);
    }

    const entryRows = await tx.query<BallotEntry>(
      `SELECT * FROM ballot_entries WHERE ballot_id = $1 AND status = 'registered'`,
      [ballotId],
    );

    const shuffled = fisherYatesShuffle(entryRows);
    const totalSlots = ballot.totalSlots;
    const now = new Date();
    const purchaseDeadlineAt = new Date(now.getTime() + ballot.purchaseWindowHours * 60 * 60 * 1000);

    const selected: Array<{ entryId: string; userId: string; rank: number }> = [];

    for (let i = 0; i < shuffled.length; i++) {
      const entry = shuffled[i];
      if (!entry) continue;

      if (i < totalSlots) {
        const rank = i + 1;
        await tx.execute(
          `UPDATE ballot_entries SET status = 'selected', rank = $1, purchase_deadline_at = $2, updated_at = $3 WHERE id = $4`,
          [rank, purchaseDeadlineAt, now, entry.id],
        );
        selected.push({ entryId: entry.id, userId: entry.userId, rank });
      } else {
        const rank = i + 1;
        await tx.execute(
          `UPDATE ballot_entries SET status = 'waitlisted', rank = $1, updated_at = $2 WHERE id = $3`,
          [rank, now, entry.id],
        );
      }
    }

    await tx.execute(
      `UPDATE ballots SET status = 'drawn', drawn_at = $1 WHERE id = $2`,
      [now, ballotId],
    );

    const waitlistedCount = Math.max(0, shuffled.length - totalSlots);

    return {
      ballotId,
      selectedCount: Math.min(selected.length, totalSlots),
      waitlistedCount,
      selected,
    };
  });
}

export async function getMyBallotStatus(
  ballotId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<BallotEntry | null> {
  const rows = await deps.db.query<BallotEntry>(
    `SELECT * FROM ballot_entries WHERE ballot_id = $1 AND user_id = $2`,
    [ballotId, userId],
  );

  return rows[0] ?? null;
}

export async function forfeitSlot(
  entryId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<void> {
  return deps.db.transaction(async (tx) => {
    const entryRows = await tx.query<BallotEntry>(
      `SELECT * FROM ballot_entries WHERE id = $1 AND user_id = $2`,
      [entryId, userId],
    );

    const entry = entryRows[0];
    if (!entry) throw new BallotError('ENTRY_NOT_FOUND', `Entry not found: ${entryId}`);
    if (entry.status !== 'selected') {
      throw new BallotError('ENTRY_NOT_SELECTED', `Entry must be in selected status to forfeit, current status: ${entry.status}`);
    }

    const now = new Date();
    await tx.execute(
      `UPDATE ballot_entries SET status = 'forfeited', updated_at = $1 WHERE id = $2`,
      [now, entryId],
    );

    // Find first waitlisted entry (lowest rank among waitlisted)
    const waitlistRows = await tx.query<BallotEntry>(
      `SELECT * FROM ballot_entries WHERE ballot_id = $1 AND status = 'waitlisted' ORDER BY rank ASC LIMIT 1`,
      [entry.ballotId],
    );

    const nextInLine = waitlistRows[0];
    if (nextInLine) {
      // Get the ballot to determine purchase window
      const ballotRows = await tx.query<Ballot>(
        `SELECT * FROM ballots WHERE id = $1`,
        [entry.ballotId],
      );
      const ballot = ballotRows[0];
      const purchaseWindowHours = ballot ? ballot.purchaseWindowHours : 48;
      const purchaseDeadlineAt = new Date(now.getTime() + purchaseWindowHours * 60 * 60 * 1000);

      await tx.execute(
        `UPDATE ballot_entries SET status = 'selected', purchase_deadline_at = $1, updated_at = $2 WHERE id = $3`,
        [purchaseDeadlineAt, now, nextInLine.id],
      );
    }
  });
}
