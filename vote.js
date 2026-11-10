import { getDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const sql = getDb();
    const { name, creator, user, kind } = req.body || {};
    if (!name || !creator || !user || !kind) return res.status(400).json({ err: 'Dados incompletos.' });

    const rows = await sql`
      SELECT id, likes, dislikes, favs FROM games
      WHERE creator_key = ${creator.toLowerCase()} AND name = ${name} LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ err: 'Jogo não encontrado.' });

    const g = rows[0];
    let likes    = JSON.parse(g.likes    || '[]');
    let dislikes = JSON.parse(g.dislikes || '[]');
    let favs     = JSON.parse(g.favs     || '[]');

    const me = user.toLowerCase();
    const rm = arr => arr.filter(n => n.toLowerCase() !== me);
    const has = arr => arr.some(n => n.toLowerCase() === me);

    if (kind === 'like') {
      const was = has(likes);
      likes = rm(likes); dislikes = rm(dislikes);
      if (!was) likes.push(user);
    } else if (kind === 'dislike') {
      const was = has(dislikes);
      likes = rm(likes); dislikes = rm(dislikes);
      if (!was) dislikes.push(user);
    } else if (kind === 'fav') {
      const was = has(favs);
      favs = rm(favs);
      if (!was) favs.push(user);
    }

    await sql`
      UPDATE games SET
        likes    = ${JSON.stringify(likes)},
        dislikes = ${JSON.stringify(dislikes)},
        favs     = ${JSON.stringify(favs)}
      WHERE id = ${g.id}
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
