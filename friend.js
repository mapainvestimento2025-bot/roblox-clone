import { getDb, ensureTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const sql = getDb();
    await ensureTables();

    const { op, me, other } = req.body || {};
    if (!op || !me || !other) return res.status(400).json({ err: 'Dados incompletos.' });

    const meKey    = me.toLowerCase();
    const otherKey = other.toLowerCase();

    if (op === 'request') {
      // Adiciona pedido de amizade
      await sql`
        INSERT INTO friend_requests (from_key, to_key)
        VALUES (${meKey}, ${otherKey})
        ON CONFLICT DO NOTHING
      `;

    } else if (op === 'accept') {
      // Remove pedido
      await sql`DELETE FROM friend_requests WHERE from_key = ${otherKey} AND to_key = ${meKey}`;
      // Adiciona amizade nos dois sentidos
      const a = meKey < otherKey ? meKey : otherKey;
      const b = meKey < otherKey ? otherKey : meKey;
      await sql`INSERT INTO friendships (user_a, user_b) VALUES (${a}, ${b}) ON CONFLICT DO NOTHING`;

    } else if (op === 'decline') {
      await sql`DELETE FROM friend_requests WHERE from_key = ${otherKey} AND to_key = ${meKey}`;

    } else if (op === 'unfriend') {
      const a = meKey < otherKey ? meKey : otherKey;
      const b = meKey < otherKey ? otherKey : meKey;
      await sql`DELETE FROM friendships WHERE user_a = ${a} AND user_b = ${b}`;
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
