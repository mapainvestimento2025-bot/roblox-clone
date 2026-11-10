import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { map, user } = req.body || {};
    if (!map || !user) return res.status(400).json({ err: 'map e user obrigatórios.' });
    const now = Date.now();
    await sql`
      INSERT INTO presence (user_key, map_key, last_ms)
      VALUES (${user.toLowerCase()}, ${map}, ${now})
      ON CONFLICT (user_key) DO UPDATE SET map_key = ${map}, last_ms = ${now}
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
