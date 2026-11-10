import { getDb } from './_db.js';

const TTL = 15000; // 15s para considerar online

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();
    const { me, users } = req.query;
    if (!me || !users) return res.status(400).json({ err: 'me e users obrigatórios.' });

    const meKey = me.toLowerCase();
    const userList = users.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);

    if (!userList.length) return res.status(200).json({});

    // Busca amigos do 'me' para saber quem pode ver o mapa
    const friendships = await sql`
      SELECT user_a, user_b FROM friendships
      WHERE user_a = ${meKey} OR user_b = ${meKey}
    `;
    const myFriends = new Set(friendships.map(f => f.user_a === meKey ? f.user_b : f.user_a));

    const now = Date.now();
    const result = {};

    for (const userKey of userList) {
      const rows = await sql`
        SELECT u.last_seen_ms, p.map_key, p.last_ms
        FROM users u
        LEFT JOIN presence p ON p.user_key = u.username_key
        WHERE u.username_key = ${userKey}
        LIMIT 1
      `;
      if (!rows.length) continue;

      const r = rows[0];
      const isOnline = r.last_ms && (now - r.last_ms < TTL * 5);
      const isPlaying = r.map_key && r.last_ms && (now - r.last_ms < TTL * 5);
      const isFriend = myFriends.has(userKey);

      result[userKey] = {
        on: isOnline,
        // Só mostra o mapa para amigos
        g: (isPlaying && isFriend) ? r.map_key : null,
        s: r.last_seen_ms || 0
      };
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
