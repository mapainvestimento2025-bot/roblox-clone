import { getDb, ensureTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const sql = getDb();
    await ensureTables();

    const { users, games, friends, req: friendReqs } = req.body || {};
    const now = Date.now();

    // Importa usuários locais que o servidor ainda não conhece
    if (users && typeof users === 'object') {
      for (const [key, u] of Object.entries(users)) {
        if (!u.hash || !u.name) continue;
        const existing = await sql`SELECT id FROM users WHERE username_key = ${key} LIMIT 1`;
        if (existing.length) continue;

        // Conta se é o primeiro usuário
        const count = await sql`SELECT COUNT(*) as c FROM users`;
        const isFirst = parseInt(count[0].c) === 0;

        await sql`
          INSERT INTO users (username, username_key, email, password_hash, is_admin, is_owner, created_ms, last_seen_ms)
          VALUES (
            ${u.name},
            ${key},
            ${(u.email || '').toLowerCase()},
            ${u.hash},
            ${isFirst},
            ${isFirst},
            ${u.created || now},
            ${now}
          )
          ON CONFLICT DO NOTHING
        `;
      }
    }

    // Importa jogos
    if (games && Array.isArray(games)) {
      for (const g of games) {
        if (!g.name || !g.creator) continue;
        const creatorKey = g.creator.toLowerCase();
        await sql`
          INSERT INTO games
            (creator_key, name, description, server_size, genre, vip, blocks, parts, thumb, likes, dislikes, favs, created_ms, updated_ms)
          VALUES
            (${creatorKey}, ${g.name}, ${g.description || ''}, ${g.serverSize || 20},
             ${g.genre || 'Outro'}, ${!!g.vip}, ${g.blocks || 0},
             ${JSON.stringify(g.parts || [])}, ${g.thumb || null},
             ${JSON.stringify(g.likes || [])}, ${JSON.stringify(g.dislikes || [])}, ${JSON.stringify(g.favs || [])},
             ${g.created || now}, ${g.updated || now})
          ON CONFLICT (creator_key, name) DO NOTHING
        `;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
