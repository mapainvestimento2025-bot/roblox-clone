import { getDb, ensureTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTables();

    if (req.method === 'POST') {
      // Enviar mensagem no chat do mapa
      const { map, user, msg } = req.body || {};
      if (!map || !user || !msg) return res.status(400).json({ err: 'Dados incompletos.' });

      const clean = String(msg).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!clean) return res.status(400).json({ err: 'Mensagem vazia.' });

      const now = Date.now();
      const row = await sql`
        INSERT INTO map_chat (map_key, user_key, msg, sent_ms)
        VALUES (${map}, ${user.toLowerCase()}, ${clean}, ${now})
        RETURNING id
      `;

      // Mantém apenas as últimas 100 mensagens por mapa
      await sql`
        DELETE FROM map_chat WHERE map_key = ${map}
          AND id NOT IN (
            SELECT id FROM map_chat WHERE map_key = ${map}
            ORDER BY sent_ms DESC LIMIT 100
          )
      `;

      return res.status(200).json({ ok: true, id: row[0].id });

    } else if (req.method === 'GET') {
      // Buscar mensagens do mapa
      const { map, after } = req.query;
      if (!map) return res.status(400).json({ err: 'map obrigatório.' });

      const afterMs = parseInt(after) || 0;
      const msgs = await sql`
        SELECT id, user_key, msg, sent_ms FROM map_chat
        WHERE map_key = ${map} AND sent_ms > ${afterMs}
        ORDER BY sent_ms ASC LIMIT 60
      `;

      const formatted = msgs.map(m => ({
        id: m.id,
        u: m.user_key,
        m: m.msg,
        t: m.sent_ms
      }));

      const last = formatted.length ? formatted[formatted.length - 1].t : afterMs;
      return res.status(200).json({ ok: true, msgs: formatted, last });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
