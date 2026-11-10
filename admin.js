import { getDb, ensureTables } from './_db.js';

async function auth(sql, user, hash) {
  if (!user || !hash) return null;
  const rows = await sql`
    SELECT * FROM users WHERE username_key = ${user.toLowerCase()} AND password_hash = ${hash} LIMIT 1
  `;
  if (!rows.length) return null;
  const u = rows[0];
  if (!u.is_admin && !u.is_owner) return null;
  return u;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const sql = getDb();
    await ensureTables();

    // Garantir tabelas extras
    await sql`
      CREATE TABLE IF NOT EXISTS warnings (
        id          SERIAL PRIMARY KEY,
        user_key    VARCHAR(20) NOT NULL,
        reason      VARCHAR(300) NOT NULL DEFAULT '',
        by_name     VARCHAR(20),
        created_ms  BIGINT NOT NULL
      )
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_mod BOOLEAN NOT NULL DEFAULT FALSE`.catch(() => {});

    const { user, hash, op, target, on, id, name, color, icon, roleId, reason,
            type, until_ms, hw, dv, ip, amount, unit } = req.body || {};

    const admin = await auth(sql, user, hash);
    if (!admin) return res.status(403).json({ err: 'Acesso negado. Verifique usuário e senha.' });

    // ===== list =====
    if (op === 'list') {
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== verify =====
    if (op === 'verify') {
      if (!target) return res.status(400).json({ err: 'target obrigatório.' });
      await sql`UPDATE users SET verified = ${!!on} WHERE username_key = ${target.toLowerCase()}`;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== admin: dar/tirar admin (apenas owner) =====
    if (op === 'admin') {
      if (!admin.is_owner) return res.status(403).json({ err: 'Apenas o owner pode alterar admins.' });
      if (!target) return res.status(400).json({ err: 'target obrigatório.' });
      if (target.toLowerCase() === admin.username_key && !on) {
        return res.status(400).json({ err: 'Você não pode remover seu próprio admin.' });
      }
      await sql`UPDATE users SET is_admin = ${!!on} WHERE username_key = ${target.toLowerCase()}`;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== mod: dar/tirar moderador (apenas owner ou admin) =====
    if (op === 'mod') {
      if (!admin.is_owner && !admin.is_admin) return res.status(403).json({ err: 'Apenas owner/admin pode alterar moderadores.' });
      if (!target) return res.status(400).json({ err: 'target obrigatório.' });
      await sql`UPDATE users SET is_mod = ${!!on} WHERE username_key = ${target.toLowerCase()}`;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== warn: enviar aviso (admin/mod recebem aviso em vez de ban) =====
    if (op === 'warn') {
      if (!target) return res.status(400).json({ err: 'target obrigatório.' });
      const targetKey = target.toLowerCase();
      const now = Date.now();
      await sql`
        INSERT INTO warnings (user_key, reason, by_name, created_ms)
        VALUES (${targetKey}, ${reason || 'Comportamento inadequado.'}, ${admin.username}, ${now})
      `;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== warn_delete: remover aviso =====
    if (op === 'warn_delete') {
      if (!id) return res.status(400).json({ err: 'id obrigatório.' });
      await sql`DELETE FROM warnings WHERE id = ${parseInt(id)}`;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== ban =====
    if (op === 'ban') {
      if (!target) return res.status(400).json({ err: 'target obrigatório.' });
      const targetKey = target.toLowerCase();

      // Busca o alvo
      const targetUser = await sql`SELECT * FROM users WHERE username_key = ${targetKey} LIMIT 1`;
      const tu = targetUser[0];

      // Owner nunca pode ser banido
      if (tu && tu.is_owner) {
        return res.status(403).json({ err: '❌ O Owner não pode ser banido.' });
      }

      // Admin só pode ser banido pelo owner
      if (tu && tu.is_admin && !admin.is_owner) {
        return res.status(403).json({ err: '❌ Administradores não podem ser banidos. Use "Avisar" para enviar um aviso.' });
      }

      // Mod só pode ser banido por admin ou owner
      if (tu && tu.is_mod && !admin.is_admin && !admin.is_owner) {
        return res.status(403).json({ err: '❌ Moderadores não podem ser banidos por usuários comuns.' });
      }

      const banType  = type || 'user';
      const untilMs  = until_ms || 0;
      const now      = Date.now();

      await sql`
        INSERT INTO bans (type, user_key, username, email, hw, dv, ip, reason, until_ms, created_ms, by_name, amount, unit)
        VALUES (
          ${banType},
          ${targetKey},
          ${target},
          ${null},
          ${hw || null},
          ${dv || null},
          ${ip || null},
          ${reason || ''},
          ${untilMs},
          ${now},
          ${admin.username},
          ${amount || null},
          ${unit || null}
        )
      `;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== unban =====
    if (op === 'unban') {
      if (!id) return res.status(400).json({ err: 'id obrigatório.' });
      await sql`DELETE FROM bans WHERE id = ${parseInt(id)}`;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== role_create (apenas owner) =====
    if (op === 'role_create') {
      if (!admin.is_owner) return res.status(403).json({ err: 'Apenas o owner pode criar cargos.' });
      if (!name) return res.status(400).json({ err: 'name obrigatório.' });
      await sql`
        CREATE TABLE IF NOT EXISTS roles (
          id    SERIAL PRIMARY KEY,
          name  VARCHAR(30) NOT NULL UNIQUE,
          color CHAR(7) NOT NULL DEFAULT '#3794ff',
          icon  VARCHAR(60) NOT NULL DEFAULT 'fa-star'
        )
      `;
      await sql`INSERT INTO roles (name, color, icon) VALUES (${name}, ${color || '#3794ff'}, ${icon || 'fa-star'}) ON CONFLICT DO NOTHING`;
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== role_delete (apenas owner) =====
    if (op === 'role_delete') {
      if (!admin.is_owner) return res.status(403).json({ err: 'Apenas o owner pode excluir cargos.' });
      if (!roleId) return res.status(400).json({ err: 'roleId obrigatório.' });
      await sql`DELETE FROM roles WHERE id = ${parseInt(roleId)}`.catch(() => {});
      await sql`UPDATE users SET role_id = NULL WHERE role_id = ${parseInt(roleId)}`.catch(() => {});
      return res.status(200).json(await buildList(sql, admin));
    }

    // ===== role_assign =====
    if (op === 'role_assign') {
      if (!target) return res.status(400).json({ err: 'target obrigatório.' });
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT`.catch(() => {});
      const rid = roleId ? parseInt(roleId) : null;
      await sql`UPDATE users SET role_id = ${rid} WHERE username_key = ${target.toLowerCase()}`;
      return res.status(200).json(await buildList(sql, admin));
    }

    return res.status(400).json({ err: 'Operação inválida: ' + op });
  } catch (e) {
    console.error('POST /api/admin error:', e);
    return res.status(500).json({ err: 'Erro interno: ' + e.message });
  }
}

async function buildList(sql, admin) {
  const users   = await sql`SELECT u.id, u.username, u.username_key, u.email, u.bio, u.av_head, u.av_torso, u.av_arms, u.av_legs, u.verified, u.is_admin, u.is_owner, u.is_mod, u.created_ms, u.last_seen_ms FROM users u ORDER BY u.created_ms ASC`.catch(() => sql`SELECT u.id, u.username, u.username_key, u.email, u.bio, u.av_head, u.av_torso, u.av_arms, u.av_legs, u.verified, u.is_admin, u.is_owner, u.created_ms, u.last_seen_ms FROM users u ORDER BY u.created_ms ASC`);
  const games   = await sql`SELECT * FROM games ORDER BY created_ms DESC`;
  const bans    = await sql`SELECT * FROM bans ORDER BY created_ms DESC`;
  const roles   = await sql`SELECT * FROM roles ORDER BY id ASC`.catch(() => []);
  const devices = await sql`SELECT * FROM user_devices ORDER BY last_ms DESC`;
  const warnings= await sql`SELECT * FROM warnings ORDER BY created_ms DESC`;

  const devsByUser  = {};
  for (const d of devices) {
    if (!devsByUser[d.user_key]) devsByUser[d.user_key] = [];
    devsByUser[d.user_key].push(d);
  }
  const gamesByUser = {};
  for (const g of games) {
    if (!gamesByUser[g.creator_key]) gamesByUser[g.creator_key] = [];
    gamesByUser[g.creator_key].push(g);
  }
  const warnsByUser = {};
  for (const w of warnings) {
    if (!warnsByUser[w.user_key]) warnsByUser[w.user_key] = [];
    warnsByUser[w.user_key].push(w);
  }

  const usersOut = users.map(u => ({
    name:     u.username,
    key:      u.username_key,
    email:    u.email,
    bio:      u.bio,
    avatar:   { head: u.av_head, torso: u.av_torso, arms: u.av_arms, legs: u.av_legs },
    verified: u.verified,
    admin:    u.is_admin,
    owner:    u.is_owner,
    mod:      u.is_mod || false,
    created:  u.created_ms,
    lastSeen: u.last_seen_ms,
    games: (gamesByUser[u.username_key] || []).map(g => ({
      name: g.name, visits: g.visits,
      parts: tryParse(g.parts, []).length, thumb: g.thumb
    })),
    totalParts: (gamesByUser[u.username_key] || []).reduce((s, g) => s + tryParse(g.parts, []).length, 0),
    devices: (devsByUser[u.username_key] || []).map(d => ({ hw: d.hw, dv: d.dv, ip: d.ip, last: d.last_ms })),
    warnings: (warnsByUser[u.username_key] || []).map(w => ({ id: w.id, reason: w.reason, by: w.by_name, t: w.created_ms }))
  }));

  return { ok: true, users: usersOut, bans, roles, warnings, isOwner: admin.is_owner, isAdmin: admin.is_admin };
}

function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch(e) { return fallback; }
}
