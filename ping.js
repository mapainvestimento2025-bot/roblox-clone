import { getDb, ensureTables, checkBan } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const sql = getDb();
    await ensureTables();

    const { user, hw, dv, mobile, info } = req.body || {};
    if (!user) return res.status(400).json({ err: 'user obrigatório.' });

    // Verifica ban
    const ban = await checkBan(sql, { user_key: user.toLowerCase(), hw, dv });
    if (ban) return res.status(200).json({ ban });

    const now = Date.now();

    // Atualiza last_seen
    await sql`
      UPDATE users SET last_seen_ms = ${now} WHERE username_key = ${user.toLowerCase()}
    `;

    // Atualiza presença (online, sem mapa específico)
    await sql`
      INSERT INTO presence (user_key, map_key, last_ms)
      VALUES (${user.toLowerCase()}, NULL, ${now})
      ON CONFLICT (user_key) DO UPDATE SET last_ms = ${now}
    `;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
