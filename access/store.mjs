const schema = [
  `CREATE TABLE IF NOT EXISTS guest_invites (
    id TEXT PRIMARY KEY,
    invite_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 7),
    created_at BIGINT NOT NULL,
    claim_by BIGINT NOT NULL,
    activated_at BIGINT,
    expires_at BIGINT,
    revoked_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS access_sessions (
    session_hash TEXT PRIMARY KEY,
    invite_id TEXT REFERENCES guest_invites(id),
    expires_at BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS access_sessions_expiry ON access_sessions(expires_at)',
];

const inviteFields = 'id, label, days, created_at, claim_by, activated_at, expires_at, revoked_at';
const instant = value => value == null ? null : Number(value);

function invite(row) {
  if (!row) return null;
  return {
    id: row.id, label: row.label, days: Number(row.days), createdAt: instant(row.created_at),
    claimBy: instant(row.claim_by), activatedAt: instant(row.activated_at), expiresAt: instant(row.expires_at),
    revokedAt: instant(row.revoked_at),
  };
}

async function adapter({ databaseUrl, filename }) {
  if (databaseUrl) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    pool.on('error', () => console.error('ForgeView access database connection interrupted.'));
    return {
      query: async (sql, params) => {
        let index = 0;
        return (await pool.query(sql.replaceAll('?', () => '$' + ++index), params)).rows;
      },
      close: () => pool.end(),
    };
  }
  if (!filename) throw new Error('Configure persistent invite storage.');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  return { query: (sql, params) => db.prepare(sql).all(...params), close: () => db.close() };
}

export async function openAccessStore(options) {
  const db = await adapter(options);
  const query = (sql, ...params) => db.query(sql, params);
  try {
    for (const statement of schema) await query(statement);
  } catch (error) {
    await db.close();
    throw error;
  }
  return {
    close: db.close,
    async check() { await query('SELECT 1'); },
    async createInvite({ id, hash, label, days, now, claimBy }) {
      const [row] = await query(`INSERT INTO guest_invites (id, invite_hash, label, days, created_at, claim_by)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING ${inviteFields}`, id, hash, label, days, now, claimBy);
      return invite(row);
    },
    async activate(hash, now, dayMs) {
      const [row] = await query(`UPDATE guest_invites SET activated_at = COALESCE(activated_at, ?),
        expires_at = COALESCE(expires_at, CAST(? AS BIGINT) + days * CAST(? AS BIGINT))
        WHERE invite_hash = ? AND revoked_at IS NULL AND COALESCE(expires_at, claim_by) > ?
        RETURNING ${inviteFields}`, now, now, dayMs, hash, now);
      return invite(row);
    },
    async inviteList(now) {
      return (await query(`SELECT ${inviteFields} FROM guest_invites
        ORDER BY CASE WHEN revoked_at IS NULL AND COALESCE(expires_at, claim_by) > ? THEN 0 ELSE 1 END, created_at DESC
        LIMIT 200`, now)).map(invite);
    },
    async revoke(id, now) {
      const [row] = await query(`UPDATE guest_invites SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ? RETURNING ${inviteFields}`, now, id);
      return invite(row);
    },
    async startSession(hash, id, expiresAt, now) {
      await query('DELETE FROM access_sessions WHERE expires_at <= ?', now);
      await query('INSERT INTO access_sessions (session_hash, invite_id, expires_at) VALUES (?, ?, ?)', hash, id, expiresAt);
    },
    async session(hash, now) {
      const [row] = await query(`SELECT s.invite_id, s.expires_at FROM access_sessions s
        LEFT JOIN guest_invites g ON s.invite_id = g.id
        WHERE s.session_hash = ? AND s.expires_at > ?
          AND (s.invite_id IS NULL OR (g.revoked_at IS NULL AND g.expires_at > ?))`, hash, now, now);
      if (!row) return null;
      return { role: row.invite_id ? 'guest' : 'owner', scope: row.invite_id ?? 'owner', expiresAt: instant(row.expires_at) };
    },
    async endSession(hash) { await query('DELETE FROM access_sessions WHERE session_hash = ?', hash); },
  };
}
