import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const sql = getDb();
    const { me } = req.query;
    if (!me) return res.status(400).json({ err: 'me obrigatório.' });

    const meKey = me.toLowerCase();

    // Busca amigos
    const friendships = await sql`
      SELECT user_a, user_b FROM friendships
      WHERE user_a = ${meKey} OR user_b = ${meKey}
    `;
    const friends = friendships.map(f => f.user_a === meKey ? f.user_b : f.user_a);

    if (!friends.length) return res.status(200).json({});

    const out = {};

    for (const f of friends) {
      const msgs = await sql`
        SELECT sender_key as u, body as m, sent_ms as t FROM messages
        WHERE (sender_key = ${meKey} AND receiver_key = ${f})
           OR (sender_key = ${f} AND receiver_key = ${meKey})
        ORDER BY sent_ms DESC LIMIT 1
      `;
      if (!msgs.length) continue;

      const last = msgs[0];
      const readRow = await sql`
        SELECT read_ms FROM dm_reads WHERE user_key = ${f} AND other_key = ${meKey} LIMIT 1
      `;
      const seenRow = await sql`
        SELECT last_seen_ms FROM users WHERE username_key = ${f} LIMIT 1
      `;
      const r = readRow.length ? readRow[0].read_ms : 0;
      const s = seenRow.length ? seenRow[0].last_seen_ms : 0;

      out[f] = {
        u: last.u,
        m: last.m,
        t: last.t,
        ts: last.u === meKey ? (r >= last.t ? 'read' : s >= last.t ? 'delivered' : 'sent') : undefined
      };
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
