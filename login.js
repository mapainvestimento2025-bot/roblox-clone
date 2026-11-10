import { getDb, ensureTables, checkBan } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ err: 'Método não permitido' });

  try {
    const sql = getDb();
    await ensureTables();

    const { name, hash, hw, dv, mobile, info } = req.body || {};
    if (!name || !hash) return res.status(400).json({ err: 'Dados incompletos.' });

    const usernameKey = name.trim().toLowerCase();

    // Verifica ban
    const ban = await checkBan(sql, { user_key: usernameKey, hw, dv });
    if (ban) return res.status(403).json({ err: 'Conta banida.', ban });

    // Busca usuário
    const rows = await sql`
      SELECT * FROM users WHERE username_key = ${usernameKey} LIMIT 1
    `;

    if (!rows.length) return res.status(401).json({ err: 'Usuário ou senha incorretos.' });

    const user = rows[0];
    if (user.password_hash !== hash) {
      return res.status(401).json({ err: 'Usuário ou senha incorretos.' });
    }

    const now = Date.now();

    // Atualiza last_seen
    await sql`
      UPDATE users SET last_seen_ms = ${now} WHERE username_key = ${usernameKey}
    `;

    // Atualiza/registra dispositivo
    if (hw || dv) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
      const devRow = await sql`
        SELECT id FROM user_devices WHERE user_key = ${usernameKey} AND dv = ${dv || ''} LIMIT 1
      `;
      if (devRow.length) {
        await sql`
          UPDATE user_devices SET last_ms = ${now}, ip = ${ip} WHERE id = ${devRow[0].id}
        `;
      } else {
        await sql`
          INSERT INTO user_devices (user_key, hw, dv, ip, last_ms)
          VALUES (${usernameKey}, ${hw || null}, ${dv || null}, ${ip}, ${now})
        `;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('POST /api/login error:', e);
    return res.status(500).json({ err: 'Erro interno: ' + e.message });
  }
}
