import { neon } from '@neondatabase/serverless';

let _sql = null;

export function getDb() {
  if (!_sql) {
    const connStr = process.env.BRPLAYBOX || process.env.DATABASE_URL;
    if (!connStr) {
      throw new Error('Variável BRPLAYBOX não configurada. Adicione em Settings > Environment Variables na Vercel.');
    }
    _sql = neon(connStr);
  }
  return _sql;
}

// Cria todas as tabelas na primeira execução
export async function ensureTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(20)  NOT NULL UNIQUE,
      username_key  VARCHAR(20)  NOT NULL UNIQUE,
      email         VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(128) NOT NULL,
      bio           VARCHAR(300) NOT NULL DEFAULT '',
      av_head       CHAR(7),
      av_torso      CHAR(7),
      av_arms       CHAR(7),
      av_legs       CHAR(7),
      verified      BOOLEAN NOT NULL DEFAULT FALSE,
      is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
      is_owner      BOOLEAN NOT NULL DEFAULT FALSE,
      created_ms    BIGINT NOT NULL,
      last_seen_ms  BIGINT NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS games (
      id          SERIAL PRIMARY KEY,
      creator_key VARCHAR(20) NOT NULL,
      name        VARCHAR(40) NOT NULL,
      description VARCHAR(400) NOT NULL DEFAULT '',
      server_size SMALLINT NOT NULL DEFAULT 20,
      genre       VARCHAR(30) NOT NULL DEFAULT 'Outro',
      vip         BOOLEAN NOT NULL DEFAULT FALSE,
      visits      INT NOT NULL DEFAULT 0,
      blocks      INT NOT NULL DEFAULT 0,
      parts       TEXT NOT NULL DEFAULT '[]',
      thumb       TEXT,
      likes       TEXT NOT NULL DEFAULT '[]',
      dislikes    TEXT NOT NULL DEFAULT '[]',
      favs        TEXT NOT NULL DEFAULT '[]',
      created_ms  BIGINT NOT NULL,
      updated_ms  BIGINT NOT NULL,
      UNIQUE(creator_key, name)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS friendships (
      user_a VARCHAR(20) NOT NULL,
      user_b VARCHAR(20) NOT NULL,
      PRIMARY KEY (user_a, user_b)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_key VARCHAR(20) NOT NULL,
      to_key   VARCHAR(20) NOT NULL,
      PRIMARY KEY (from_key, to_key)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id          BIGSERIAL PRIMARY KEY,
      sender_key  VARCHAR(20) NOT NULL,
      receiver_key VARCHAR(20) NOT NULL,
      body        VARCHAR(500) NOT NULL,
      reply_user  VARCHAR(40),
      reply_text  VARCHAR(100),
      reply_ms    BIGINT,
      sent_ms     BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS dm_reads (
      user_key  VARCHAR(20) NOT NULL,
      other_key VARCHAR(20) NOT NULL,
      read_ms   BIGINT NOT NULL,
      PRIMARY KEY (user_key, other_key)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bans (
      id         SERIAL PRIMARY KEY,
      type       VARCHAR(10) NOT NULL,
      user_key   VARCHAR(20),
      username   VARCHAR(20),
      email      VARCHAR(120),
      hw         TEXT,
      dv         TEXT,
      ip         TEXT,
      reason     VARCHAR(300) NOT NULL DEFAULT '',
      until_ms   BIGINT NOT NULL DEFAULT 0,
      created_ms BIGINT NOT NULL,
      by_name    VARCHAR(20),
      amount     SMALLINT,
      unit       VARCHAR(10)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_devices (
      id       BIGSERIAL PRIMARY KEY,
      user_key VARCHAR(20) NOT NULL,
      hw       VARCHAR(64),
      dv       VARCHAR(64),
      ip       VARCHAR(64),
      last_ms  BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS map_chat (
      id      BIGSERIAL PRIMARY KEY,
      map_key VARCHAR(200) NOT NULL,
      user_key VARCHAR(20) NOT NULL,
      msg     VARCHAR(200) NOT NULL,
      sent_ms BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_map_chat ON map_chat(map_key, sent_ms)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS presence (
      user_key VARCHAR(20) NOT NULL,
      map_key  VARCHAR(200),
      tab_id   VARCHAR(64),
      last_ms  BIGINT NOT NULL,
      PRIMARY KEY (user_key)
    )
  `;
}

export function json(res, data, status = 200) {
  res.status(status).json(data);
}

export function err(res, msg, status = 400) {
  res.status(status).json({ err: msg });
}

// Verifica ban do usuário/hw/dv
export async function checkBan(sql, { user_key, hw, dv }) {
  const now = Date.now();
  const rows = await sql`
    SELECT * FROM bans
    WHERE (until_ms = 0 OR until_ms > ${now})
      AND (
        (user_key = ${user_key || ''})
        OR (hw IS NOT NULL AND hw = ${hw || ''})
        OR (dv IS NOT NULL AND dv = ${dv || ''})
      )
    LIMIT 1
  `;
  if (!rows.length) return null;
  const b = rows[0];
  return {
    text: b.reason || 'Você foi banido.',
    until: b.until_ms > 0 ? b.until_ms : null,
    perm: b.until_ms === 0
  };
}
