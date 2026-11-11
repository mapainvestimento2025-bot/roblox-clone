import { phpGet } from './_db.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { return res.status(200).json(await phpGet('stats')); }
  catch (e) { return res.status(200).json({ ok: true, totalUsers: 0, totalGames: 0, totalViews: 0, online: 0 }); }
}
