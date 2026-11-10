import { getDb } from './_db.js';

const TTL = 75000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const sql = getDb();
    const { op, base, user, size, tab } = req.body || {};
    if (!op || !user) return res.status(400).json({ err: 'Dados incompletos.' });

    const userKey = user.toLowerCase();
    const now = Date.now();

    if (op === 'join') {
      // Verifica se o usuário já está jogando este mapa em outro tab
      const existing = await sql`
        SELECT map_key, tab_id, last_ms FROM presence
        WHERE user_key = ${userKey} LIMIT 1
      `;
      if (existing.length && existing[0].map_key &&
          existing[0].map_key.startsWith(base + '#') &&
          existing[0].tab_id !== tab &&
          (now - existing[0].last_ms) < TTL) {
        return res.status(200).json({ busy: true });
      }

      // Busca instâncias ativas deste mapa
      const instances = await sql`
        SELECT map_key, COUNT(*) as cnt FROM presence
        WHERE map_key LIKE ${base + '#%'} AND last_ms > ${now - TTL}
        GROUP BY map_key
      `;

      const maxSize = Math.max(1, size || 20);
      const instMap = {};
      for (const i of instances) {
        const idx = parseInt(i.map_key.split('#')[1] || '0');
        instMap[idx] = parseInt(i.cnt);
      }

      // Escolhe servidor com vaga
      let idx = 0;
      while ((instMap[idx] || 0) >= maxSize) idx++;

      const mapKey = base + '#' + idx;
      await sql`
        INSERT INTO presence (user_key, map_key, tab_id, last_ms)
        VALUES (${userKey}, ${mapKey}, ${tab || null}, ${now})
        ON CONFLICT (user_key) DO UPDATE SET map_key = ${mapKey}, tab_id = ${tab || null}, last_ms = ${now}
      `;

      return res.status(200).json({ idx });

    } else if (op === 'refresh') {
      await sql`
        UPDATE presence SET last_ms = ${now}
        WHERE user_key = ${userKey} AND tab_id = ${tab || null}
      `;
      return res.status(200).json({ ok: true });

    } else if (op === 'release') {
      await sql`
        DELETE FROM presence WHERE user_key = ${userKey} AND tab_id = ${tab || null}
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ err: 'Operação inválida.' });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
