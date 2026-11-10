import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { user, avatar } = req.body || {};
    if (!user || !avatar) return res.status(400).json({ err: 'Dados incompletos.' });
    await sql`
      UPDATE users SET
        av_head  = ${avatar.head  || null},
        av_torso = ${avatar.torso || null},
        av_arms  = ${avatar.arms  || null},
        av_legs  = ${avatar.legs  || null}
      WHERE username_key = ${user.toLowerCase()}
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
