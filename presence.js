import { getDb, ensureTables } from './_db.js';

const TTL = 75000; // 75s

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTables();

    if (req.method === 'GET') {
      // Retorna quem está online e em qual mapa
      const now = Date.now();
      const rows = await sql`
        SELECT user_key, map_key FROM presence WHERE last_ms > ${now - TTL}
      `;
      const cache = {};
      for (const r of rows) {
        const map = r.map_key;
        if (!cache[map]) cache[map] = [];
        if (!cache[map].includes(r.user_key)) cache[map].push(r.user_key);
      }
      return res.status(200).json(cache);
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
