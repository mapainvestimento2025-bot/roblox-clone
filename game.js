import { getDb, ensureTables } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ err: 'Método não permitido' });

  try {
    const sql = getDb();
    await ensureTables();

    const { creator, game } = req.body || {};
    if (!creator || !game || !game.name) {
      return res.status(400).json({ err: 'Dados do jogo incompletos.' });
    }

    const creatorKey = creator.toLowerCase();
    const now = Date.now();

    // Verifica se já existe (UPDATE) ou cria (INSERT)
    const existing = await sql`
      SELECT id FROM games WHERE creator_key = ${creatorKey} AND name = ${game.name} LIMIT 1
    `;

    const parts = JSON.stringify(game.parts || []);
    const likes = JSON.stringify(game.likes || []);
    const dislikes = JSON.stringify(game.dislikes || []);
    const favs = JSON.stringify(game.favs || []);

    if (existing.length > 0) {
      await sql`
        UPDATE games SET
          description = ${game.description || ''},
          server_size = ${game.serverSize || 20},
          genre       = ${game.genre || 'Outro'},
          vip         = ${!!game.vip},
          blocks      = ${game.blocks || 0},
          parts       = ${parts},
          thumb       = ${game.thumb || null},
          updated_ms  = ${now}
        WHERE creator_key = ${creatorKey} AND name = ${game.name}
      `;
    } else {
      await sql`
        INSERT INTO games
          (creator_key, name, description, server_size, genre, vip, blocks, parts, thumb, likes, dislikes, favs, created_ms, updated_ms)
        VALUES
          (${creatorKey}, ${game.name}, ${game.description || ''}, ${game.serverSize || 20},
           ${game.genre || 'Outro'}, ${!!game.vip}, ${game.blocks || 0}, ${parts},
           ${game.thumb || null}, ${likes}, ${dislikes}, ${favs}, ${game.created || now}, ${now})
      `;
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('POST /api/game error:', e);
    return res.status(500).json({ err: 'Erro interno: ' + e.message });
  }
}
