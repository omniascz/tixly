/**
 * cross-device-linker.ts
 *
 * On user login (or any authenticated event) we connect prior anonymous
 * touchpoints for the current session to the now-known user_id, so that
 * multi-touch attribution can traverse pre-login and post-login journeys.
 *
 * Intended to be invoked from the auth layer:
 *
 *   onLoginSuccess(userId, sessionId) {
 *     await linkSessionToUser(db, sessionId, userId);
 *   }
 */

export interface LinkerDb {
  execute(
    sql: string,
    params: unknown[],
  ): Promise<{ rowsAffected: number }>;
}

/**
 * Attaches all anonymous touchpoints for `sessionId` to `userId`.
 * Returns the number of rows updated (for telemetry / tests).
 */
export async function linkSessionToUser(
  db: LinkerDb,
  sessionId: string,
  userId: string,
): Promise<number> {
  if (!sessionId || !userId) {
    throw new Error("linkSessionToUser requires both sessionId and userId");
  }

  const result = await db.execute(
    `UPDATE attribution.touch_points
        SET user_id = $1
      WHERE session_id = $2
        AND user_id IS NULL`,
    [userId, sessionId],
  );

  return result.rowsAffected;
}
