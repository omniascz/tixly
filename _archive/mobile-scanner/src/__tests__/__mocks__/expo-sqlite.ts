// ---------------------------------------------------------------------------
// In-memory expo-sqlite mock for unit tests
// Implements the synchronous API surface used by offline-cache.ts
// ---------------------------------------------------------------------------

interface Row {
  [col: string]: unknown;
}

/**
 * Minimal SQL engine backed by Maps.
 * Supports: CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO UPDATE,
 * SELECT *, UPDATE, DELETE, PRAGMA (no-op), and simple transactions.
 */

type TableStore = Map<string, Row[]>;

// Global in-memory storage shared by the singleton database
let tables: TableStore = new Map();

/** Reset state between tests */
export function __resetDatabase(): void {
  tables = new Map();
  primaryKeyMap.clear();
}

// ---------------------------------------------------------------------------
// Very small SQL parser helpers
// ---------------------------------------------------------------------------

function ensureTable(name: string): Row[] {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name)!;
}

function getTableRows(name: string): Row[] {
  return tables.get(name) ?? [];
}

/**
 * Extracts the table name from a simple SQL statement.
 */
function extractTableName(sql: string): string | null {
  const m =
    sql.match(/(?:INTO|FROM|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(\w+)/i);
  return m ? m[1] : null;
}

/**
 * Parses WHERE clause of the form "col = ?" or "col1 = ? AND col2 IN (...)"
 * This is a very limited parser sufficient for the offline-cache operations.
 */
function matchesWhere(
  row: Row,
  whereClause: string | undefined,
  params: unknown[]
): boolean {
  if (!whereClause) return true;

  // Handle "col IN (SELECT col FROM tbl WHERE synced_at < ?)"
  // We'll just return true here — the actual delete will handle it via iteration
  if (/IN\s*\(/i.test(whereClause)) {
    return true; // handled separately in DELETE logic
  }

  // Split on AND
  const conditions = whereClause.split(/\s+AND\s+/i);
  let paramIdx = 0;
  for (const cond of conditions) {
    const eqMatch = cond.match(/(\w+)\s*=\s*\?/);
    if (eqMatch) {
      const col = eqMatch[1];
      if (row[col] !== params[paramIdx]) return false;
      paramIdx++;
    }
    const ltMatch = cond.match(/(\w+)\s*<\s*\?/);
    if (ltMatch) {
      const col = ltMatch[1];
      if ((row[col] as number) >= (params[paramIdx] as number)) return false;
      paramIdx++;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Statement-level handlers
// ---------------------------------------------------------------------------

function parsePrimaryKeysFromCreateTable(sql: string): string[] {
  // Composite PK: PRIMARY KEY (col1, col2)
  const compositePk = sql.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
  if (compositePk) {
    return compositePk[1].split(",").map((s) => s.trim());
  }
  // Inline PK on a single column: col_name TYPE PRIMARY KEY
  const inlinePk = sql.match(/(\w+)\s+\w+[^,]*PRIMARY\s+KEY/i);
  if (inlinePk) {
    return [inlinePk[1]];
  }
  return [];
}

function execCreate(sql: string): void {
  // Match each individual CREATE TABLE block
  const tableBlocks = sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([^;]*)\)/gis
  );
  for (const m of tableBlocks) {
    const tableName = m[1];
    const body = m[2];
    ensureTable(tableName);
    const pks = parsePrimaryKeysFromCreateTable(body);
    if (pks.length > 0) {
      primaryKeyMap.set(tableName, pks);
    }
  }

  // Fallback: ensure tables even without body match (simple names)
  const nameMatches = sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi
  );
  for (const m of nameMatches) {
    ensureTable(m[1]);
  }
}

function execInsert(sql: string, params: unknown[]): void {
  // Detect ON CONFLICT DO UPDATE (upsert)
  const isUpsert = /ON\s+CONFLICT\s*\((\w+)\)\s+DO\s+UPDATE/i.test(sql);

  const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
  if (!tableMatch) return;

  const tableName = tableMatch[1];
  const colNames = tableMatch[2]
    .split(",")
    .map((c) => c.trim().replace(/"/g, ""));
  const rows = ensureTable(tableName);

  const newRow: Row = {};
  colNames.forEach((col, i) => {
    newRow[col] = params[i];
  });

  if (isUpsert) {
    // Find the conflict column
    const conflictMatch = sql.match(/ON\s+CONFLICT\s*\((\w+)\)/i);
    const conflictCol = conflictMatch ? conflictMatch[1] : colNames[0];

    // Parse SET assignments from DO UPDATE SET ...
    const setMatch = sql.match(/DO\s+UPDATE\s+SET\s+([\s\S]+?)(?:$|WHERE)/i);
    const setAssignments: Record<string, string> = {};
    if (setMatch) {
      const parts = setMatch[1].split(",");
      for (const part of parts) {
        const assignMatch = part.match(/(\w+)\s*=\s*excluded\.(\w+)/i);
        if (assignMatch) {
          setAssignments[assignMatch[1]] = assignMatch[2];
        }
      }
    }

    const existingIdx = rows.findIndex(
      (r) => r[conflictCol] === newRow[conflictCol]
    );
    if (existingIdx >= 0) {
      // Update existing row with SET assignments
      if (Object.keys(setAssignments).length > 0) {
        for (const [col, srcCol] of Object.entries(setAssignments)) {
          rows[existingIdx][col] = newRow[srcCol];
        }
      } else {
        rows[existingIdx] = newRow;
      }
    } else {
      rows.push(newRow);
    }
  } else {
    // Plain insert — check PRIMARY KEY uniqueness
    const primaryKeys = getPrimaryKeys(tableName);
    const existing = primaryKeys.length
      ? rows.findIndex((r) => primaryKeys.every((pk) => r[pk] === newRow[pk]))
      : -1;

    if (existing >= 0) {
      // Simulate UNIQUE constraint violation
      throw new Error(`UNIQUE constraint failed: ${tableName}.pk`);
    }
    rows.push(newRow);
  }
}

/**
 * Track which columns are primary keys per table.
 * The mock infers them from table schema strings during CREATE TABLE.
 */
const primaryKeyMap: Map<string, string[]> = new Map();

function getPrimaryKeys(tableName: string): string[] {
  return primaryKeyMap.get(tableName) ?? [];
}

function execUpdate(sql: string, params: unknown[]): void {
  const tableMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)/i);
  if (!tableMatch) return;

  const tableName = tableMatch[1];
  const setClause = tableMatch[2];
  const whereClause = tableMatch[3].trim();
  const rows = ensureTable(tableName);

  // Parse SET assignments: "col = ?" or "col = 'literal'"
  const setAssignments: Array<{ col: string; usesParam: boolean; literal?: unknown }> = [];
  const setCols = setClause.split(",");
  for (const part of setCols) {
    const paramMatch = part.match(/(\w+)\s*=\s*\?/);
    const literalMatch = part.match(/(\w+)\s*=\s*'([^']+)'/);
    if (paramMatch) {
      setAssignments.push({ col: paramMatch[1].trim(), usesParam: true });
    } else if (literalMatch) {
      setAssignments.push({
        col: literalMatch[1].trim(),
        usesParam: false,
        literal: literalMatch[2],
      });
    }
  }

  // Count param slots in WHERE
  const whereParamCount = (whereClause.match(/\?/g) ?? []).length;
  const setParamCount = setAssignments.filter((a) => a.usesParam).length;
  const setParams = params.slice(0, setParamCount);
  const whereParams = params.slice(setParamCount);

  for (const row of rows) {
    if (matchesWhere(row, whereClause, whereParams)) {
      let setParamIdx = 0;
      for (const assignment of setAssignments) {
        if (assignment.usesParam) {
          row[assignment.col] = setParams[setParamIdx++];
        } else {
          row[assignment.col] = assignment.literal;
        }
      }
    }
  }
}

function execDelete(sql: string, params: unknown[]): void {
  const subqueryMatch = sql.match(
    /DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s+IN\s*\(\s*SELECT\s+(\w+)\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*<\s*\?\s*\)/i
  );

  if (subqueryMatch) {
    const [, targetTable, targetCol, srcCol, srcTable, filterCol] = subqueryMatch;
    const cutoff = params[0] as number;
    const srcRows = getTableRows(srcTable);
    const idsToDelete = new Set(
      srcRows.filter((r) => (r[filterCol] as number) < cutoff).map((r) => r[srcCol])
    );
    const rows = ensureTable(targetTable);
    const filtered = rows.filter((r) => !idsToDelete.has(r[targetCol]));
    tables.set(targetTable, filtered);
    return;
  }

  const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+([\s\S]+)/i);
  if (!tableMatch) return;
  const tableName = tableMatch[1];
  const whereClause = tableMatch[2].trim();
  const rows = ensureTable(tableName);
  const remaining = rows.filter((r) => !matchesWhere(r, whereClause, params));
  tables.set(tableName, remaining);
}

function execSelect(sql: string, params: unknown[]): Row[] {
  const tableMatch = sql.match(/FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s*;)?$/i);
  if (!tableMatch) return [];

  const tableName = tableMatch[1];
  const whereClause = tableMatch[2]?.trim();
  const rows = getTableRows(tableName);

  if (!whereClause) return [...rows];
  return rows.filter((r) => matchesWhere(r, whereClause, params));
}

// ---------------------------------------------------------------------------
// Mock database object
// ---------------------------------------------------------------------------

function dispatch(sql: string, params: unknown[] = []): Row[] {
  const trimmed = sql.trim().replace(/\s+/g, " ");
  const upper = trimmed.toUpperCase();

  if (upper.startsWith("PRAGMA") || upper.startsWith("CREATE TABLE")) {
    // Handle compound exec strings (multiple statements separated by semicolons)
    if (upper.startsWith("CREATE")) {
      execCreate(trimmed);
    }
    return [];
  }
  if (upper.startsWith("INSERT")) {
    execInsert(trimmed, params);
    return [];
  }
  if (upper.startsWith("UPDATE")) {
    execUpdate(trimmed, params);
    return [];
  }
  if (upper.startsWith("DELETE")) {
    execDelete(trimmed, params);
    return [];
  }
  if (upper.startsWith("SELECT")) {
    return execSelect(trimmed, params);
  }
  return [];
}

const mockDb = {
  execSync(sql: string): void {
    // Handle multiple statements separated by semicolons
    const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      dispatch(stmt);
    }
  },

  runSync(sql: string, params: unknown[] = []): void {
    dispatch(sql, params);
  },

  getAllSync<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
    return dispatch(sql, params) as T[];
  },

  withTransactionSync(fn: () => void): void {
    // No real transaction support needed for unit tests
    fn();
  },
};

// ---------------------------------------------------------------------------
// Exported mock module (mirrors expo-sqlite public API)
// ---------------------------------------------------------------------------

export function openDatabaseSync(_name: string) {
  return mockDb;
}

// Named export for manual import in tests
export const mockDatabase = mockDb;
