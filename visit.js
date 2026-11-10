import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { name, creator } = req.body || {};
    if (!name || !creator) return res.status(400).json({ err: 'Dados incompletos.' });
    await sql`
      UPDATE games SET visits = visits + 1
      WHERE creator_key = ${creator.toLowerCase()} AND name = ${name}
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
