import { getDb } from './_db.js';

const TTL = 75000; // 75s para considerar online

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();
    const now = Date.now();

    const [userCount]  = await sql`SELECT COUNT(*) as c FROM users`;
    const [gameCount]  = await sql`SELECT COUNT(*) as c FROM games`;
    const [visitCount] = await sql`SELECT COALESCE(SUM(visits), 0) as c FROM games`;
    const [onlineCount]= await sql`SELECT COUNT(*) as c FROM presence WHERE last_ms > ${now - TTL}`;

    return res.status(200).json({
      ok:          true,
      totalUsers:  parseInt(userCount.c),
      totalGames:  parseInt(gameCount.c),
      totalViews:  parseInt(visitCount.c),
      online:      parseInt(onlineCount.c)
    });
  } catch (e) {
    return res.status(200).json({ ok: true, totalUsers: 0, totalGames: 0, totalViews: 0, online: 0 });
  }
}
