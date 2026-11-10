import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { user, bio } = req.body || {};
    if (!user) return res.status(400).json({ err: 'Usuário não informado.' });
    const bioClean = String(bio || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 300);
    await sql`UPDATE users SET bio = ${bioClean} WHERE username_key = ${user.toLowerCase()}`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
