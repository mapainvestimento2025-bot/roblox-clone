import { getDb, ensureTables, checkBan } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ err: 'Método não permitido' });

  try {
    const sql = getDb();
    await ensureTables();

    const { name, email, hash, hw, dv, mobile, info } = req.body || {};

    if (!name || !hash) return res.status(400).json({ err: 'Dados incompletos.' });

    const usernameKey = name.trim().toLowerCase();
    const username = name.trim();

    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ err: 'Usuário: 3 a 20 letras, números ou _ (sem espaços).' });
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ err: 'Digite um e-mail válido.' });
    }

    // Verifica ban por hw/dv antes de registrar
    const ban = await checkBan(sql, { user_key: usernameKey, hw, dv });
    if (ban) return res.status(403).json({ err: 'Conta banida.', ban });

    // Verifica se já existe
    const existing = await sql`
      SELECT id FROM users WHERE username_key = ${usernameKey} LIMIT 1
    `;

    if (existing.length > 0) {
      // Conta já existe — retorna ok para o auth.js poder fazer login
      return res.status(200).json({ ok: true, exists: true });
    }

    // Verifica se e-mail já está em uso
    if (email) {
      const emailCheck = await sql`
        SELECT id FROM users WHERE email = ${email.toLowerCase()} LIMIT 1
      `;
      if (emailCheck.length > 0) {
        return res.status(400).json({ err: 'Esse e-mail já está cadastrado.' });
      }
    }

    // Verifica se é o primeiro usuário (vira owner automaticamente)
    const count = await sql`SELECT COUNT(*) as c FROM users`;
    const isFirst = parseInt(count[0].c) === 0;

    const now = Date.now();

    await sql`
      INSERT INTO users (username, username_key, email, password_hash, is_admin, is_owner, created_ms, last_seen_ms)
      VALUES (
        ${username},
        ${usernameKey},
        ${(email || '').toLowerCase()},
        ${hash},
        ${isFirst},
        ${isFirst},
        ${now},
        ${now}
      )
    `;

    // Registra dispositivo
    if (hw || dv) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
      await sql`
        INSERT INTO user_devices (user_key, hw, dv, ip, last_ms)
        VALUES (${usernameKey}, ${hw || null}, ${dv || null}, ${ip}, ${now})
      `;
    }

    return res.status(200).json({ ok: true, owner: isFirst });
  } catch (e) {
    console.error('POST /api/register error:', e);
    return res.status(500).json({ err: 'Erro interno: ' + e.message });
  }
}
