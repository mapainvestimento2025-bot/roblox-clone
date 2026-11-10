import { getDb, ensureTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTables();

    if (req.method === 'POST') {
      const { from, to, msg, reply } = req.body || {};
      if (!from || !to || !msg) return res.status(400).json({ err: 'Dados incompletos.' });

      const clean = String(msg).trim().slice(0, 500);
      if (!clean) return res.status(400).json({ err: 'Mensagem vazia.' });

      const now = Date.now();
      await sql`
        INSERT INTO messages (sender_key, receiver_key, body, reply_user, reply_text, reply_ms, sent_ms)
        VALUES (
          ${from.toLowerCase()},
          ${to.toLowerCase()},
          ${clean},
          ${reply?.u || null},
          ${reply?.m ? reply.m.slice(0, 100) : null},
          ${reply?.t || null},
          ${now}
        )
      `;

      return res.status(200).json({ ok: true });

    } else if (req.method === 'GET') {
      const { me, other, read } = req.query;
      if (!me || !other) return res.status(400).json({ err: 'me e other obrigatórios.' });

      const meKey    = me.toLowerCase();
      const otherKey = other.toLowerCase();

      const msgs = await sql`
        SELECT * FROM messages
        WHERE (sender_key = ${meKey} AND receiver_key = ${otherKey})
           OR (sender_key = ${otherKey} AND receiver_key = ${meKey})
        ORDER BY sent_ms ASC LIMIT 300
      `;

      const formatted = msgs.map(m => ({
        u: m.sender_key,
        m: m.body,
        t: m.sent_ms,
        r: m.reply_user ? { u: m.reply_user, m: m.reply_text, t: m.reply_ms } : undefined
      }));

      // Atualiza last_seen do 'me'
      const now = Date.now();
      await sql`
        UPDATE users SET last_seen_ms = ${now} WHERE username_key = ${meKey}
      `;

      // Marca como lido se read=1
      let readMs = 0;
      let otherSeen = 0;

      if (read === '1' && formatted.length) {
        const lastT = formatted[formatted.length - 1].t;
        await sql`
          INSERT INTO dm_reads (user_key, other_key, read_ms)
          VALUES (${meKey}, ${otherKey}, ${now})
          ON CONFLICT (user_key, other_key) DO UPDATE SET read_ms = ${now}
        `;
        readMs = now;
      } else {
        const readRow = await sql`
          SELECT read_ms FROM dm_reads WHERE user_key = ${meKey} AND other_key = ${otherKey} LIMIT 1
        `;
        readMs = readRow.length ? readRow[0].read_ms : 0;
      }

      // Busca quando o 'other' leu e quando viu por último
      const otherReadRow = await sql`
        SELECT read_ms FROM dm_reads WHERE user_key = ${otherKey} AND other_key = ${meKey} LIMIT 1
      `;
      const otherUser = await sql`
        SELECT last_seen_ms FROM users WHERE username_key = ${otherKey} LIMIT 1
      `;
      const otherReadMs = otherReadRow.length ? otherReadRow[0].read_ms : 0;
      otherSeen = otherUser.length ? otherUser[0].last_seen_ms : 0;

      return res.status(200).json({
        ok: true,
        msgs: formatted,
        st: {
          r: otherReadMs,
          s: otherSeen,
          online: now - otherSeen < 12000
        }
      });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
