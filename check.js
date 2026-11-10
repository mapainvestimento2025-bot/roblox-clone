import { getDb, checkBan } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { user, hw, dv } = req.body || {};
    const ban = await checkBan(sql, { user_key: user?.toLowerCase() || '', hw, dv });
    if (ban) return res.status(200).json({ ban });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
