import { getDb, ensureTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sql = getDb();
    await ensureTables();

    // Busca última atualização do banco para suportar ?v= (cache busting)
    const clientV = parseInt(req.query?.v) || 0;
    const lastRow = await sql`
      SELECT GREATEST(
        COALESCE((SELECT MAX(last_seen_ms) FROM users), 0),
        COALESCE((SELECT MAX(updated_ms)   FROM games),  0)
      ) as last_ms
    `;
    const serverV = parseInt(lastRow[0]?.last_ms) || 0;

    // Se o cliente já tem a versão mais recente, retorna { same: true }
    if (clientV > 0 && clientV >= serverV) {
      return res.status(200).json({ same: true, v: serverV });
    }

    // Busca todos os usuários (sem senha/email)
    const users = await sql`
      SELECT username, username_key, bio,
             av_head, av_torso, av_arms, av_legs,
             verified, is_admin, is_owner,
             created_ms, last_seen_ms, id
      FROM users ORDER BY created_ms ASC
    `;

    const games = await sql`
      SELECT * FROM games ORDER BY created_ms DESC LIMIT 200
    `;

    const friendships = await sql`SELECT * FROM friendships`;
    const requests    = await sql`SELECT * FROM friend_requests`;

    // Monta objeto de usuários compatível com auth.js
    const usersObj = {};
    for (const u of users) {
      usersObj[u.username_key] = {
        name: u.username,
        bio: u.bio || '',
        avatar: {
          head:  u.av_head  || '#f5cd30',
          torso: u.av_torso || '#0d69ac',
          arms:  u.av_arms  || '#f5cd30',
          legs:  u.av_legs  || '#4b974b'
        },
        verified:  u.verified,
        admin:     u.is_admin,
        owner:     u.is_owner,
        created:   u.created_ms,
        last_seen_ms: u.last_seen_ms,
        id: u.id
      };
    }

    // Monta jogos no formato original
    const gamesArr = games.map(g => ({
      name:        g.name,
      creator:     g.creator_key,
      description: g.description,
      serverSize:  g.server_size,
      genre:       g.genre,
      vip:         g.vip,
      visits:      g.visits,
      blocks:      g.blocks,
      parts:    tryParse(g.parts,    []),
      thumb:       g.thumb,
      likes:    tryParse(g.likes,    []),
      dislikes: tryParse(g.dislikes, []),
      favs:     tryParse(g.favs,     []),
      created:     g.created_ms,
      updated:     g.updated_ms
    }));

    // Monta amizades
    const friendsObj = {};
    for (const f of friendships) {
      if (!friendsObj[f.user_a]) friendsObj[f.user_a] = [];
      if (!friendsObj[f.user_b]) friendsObj[f.user_b] = [];
      if (!friendsObj[f.user_a].includes(f.user_b)) friendsObj[f.user_a].push(f.user_b);
      if (!friendsObj[f.user_b].includes(f.user_a)) friendsObj[f.user_b].push(f.user_a);
    }

    // Monta pedidos de amizade
    const reqObj = {};
    for (const r of requests) {
      if (!reqObj[r.to_key]) reqObj[r.to_key] = [];
      if (!reqObj[r.to_key].includes(r.from_key)) reqObj[r.to_key].push(r.from_key);
    }

    const now = Date.now();

    return res.status(200).json({
      ok:    true,
      db:    { users: usersObj, games: gamesArr, friends: friendsObj, req: reqObj, roles: {} },
      v:     serverV || now,
      users: users.length
    });
  } catch (e) {
    console.error('GET /api/db error:', e);
    return res.status(500).json({ err: e.message });
  }
}

function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch(e) { return fallback; }
}
