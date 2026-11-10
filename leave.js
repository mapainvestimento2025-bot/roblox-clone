import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { map, user } = req.body || {};
    if (!user) return res.status(400).json({ err: 'user obrigatório.' });
    await sql`DELETE FROM presence WHERE user_key = ${user.toLowerCase()}`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
