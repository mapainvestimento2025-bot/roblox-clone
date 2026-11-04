/* store.js - guarda tudo no MySQL/MariaDB (XAMPP). O server.js continua trabalhando em memória (rápido) e
   este arquivo grava as mudanças no banco em segundo plano e carrega tudo de volta quando o servidor liga.
   Se o MySQL não estiver ligado, o servidor avisa e continua usando data.json (nada quebra). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const key = n => String(n || '').trim().toLowerCase();
const pairKey = (a, b) => [key(a), key(b)].sort().join('|');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

function config() {
  const c = { enabled: true, host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'roblox_clone' };
  try { Object.assign(c, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).mysql || {}); } catch (e) {}
  const e = process.env;
  if (e.DB_HOST) c.host = e.DB_HOST; if (e.DB_PORT) c.port = +e.DB_PORT; if (e.DB_USER) c.user = e.DB_USER;
  if (e.DB_PASS !== undefined) c.password = e.DB_PASS; if (e.DB_NAME) c.database = e.DB_NAME; if (e.DB_OFF === '1') c.enabled = false;
  return c;
}
let pool = null, cfg = config(), ctx = null, busy = false, dirty = { db: false, dms: false }, H = { users: {}, uid: {}, games: {}, votes: {}, fr: '', rq: '', bans: '', dev: '', dm: {}, rd: {}, seen: {} };
const log = (...a) => console.log('  [MySQL]', ...a);

async function init() {
  if (!cfg.enabled) return { mode: 'json', why: 'desativado em config.json' };
  let mysql; try { mysql = require('mysql2/promise'); } catch (e) { return { mode: 'json', why: 'pacote mysql2 não instalado — rode:  npm install' }; }
  try {
    const boot = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, connectTimeout: 4000 });
    await boot.query('CREATE DATABASE IF NOT EXISTS `' + cfg.database.replace(/`/g, '') + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await boot.end();
    pool = mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, connectionLimit: 4, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: false, connectTimeout: 4000 });
    const sql = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8').replace(/^\s*--.*$/gm, '').replace(/CREATE DATABASE[^;]*;/i, '').replace(/USE\s+`[^`]*`;/i, '');
    for (const st of sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) await pool.query(st);
    await migrate();
    return { mode: 'mysql', cfg };
  } catch (e) { pool = null; return { mode: 'json', why: e.code === 'ECONNREFUSED' ? 'MySQL desligado — abra o XAMPP e clique em Start no MySQL' : e.message }; }
}

/* bancos criados antes dos banimentos: adiciona as colunas novas (não apaga nada) */
async function migrate() {
  const has = async (t, c) => (await pool.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [t, c]))[0].length > 0;
  if (!(await has('users', 'verified'))) await pool.query('ALTER TABLE users ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0');
  if (!(await has('users', 'is_admin'))) await pool.query('ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0');
}

/* ---------- carregar tudo do banco ---------- */
async function load() {
  const [us] = await pool.query('SELECT * FROM users ORDER BY id');
  if (!us.length) return null;
  const db = { users: {}, games: [], friends: {}, req: {}, v: 1 }, byId = {}, dms = {}, seen = {};
  us.forEach(r => {
    const u = { id: r.id, name: r.username, email: r.email, hash: r.password_hash, created: +r.created_ms, bio: r.bio || '', verified: !!r.verified, admin: !!r.is_admin }; H.uid[key(r.username)] = r.id;
    if (r.av_head) u.avatar = { head: r.av_head, torso: r.av_torso, arms: r.av_arms, legs: r.av_legs };
    db.users[key(r.username)] = u; byId[r.id] = u; if (+r.last_seen_ms) seen[key(r.username)] = +r.last_seen_ms;
  });
  const [gs] = await pool.query('SELECT * FROM games ORDER BY id'), [vs] = await pool.query('SELECT * FROM game_votes'), gById = {};
  gs.forEach(r => {
    const c = byId[r.creator_id]; if (!c) return;
    let parts = []; try { parts = JSON.parse(r.parts); } catch (e) {}
    const g = { name: r.name, creator: c.name, blocks: r.blocks, parts, thumb: r.thumb || '', desc: r.description, serverSize: r.server_size, genre: r.genre, vip: !!r.vip, created: +r.created_ms, updated: +r.updated_ms, visits: r.visits, t: +r.created_ms, likes: [], dislikes: [], favs: [] };
    db.games.push(g); gById[r.id] = g;
  });
  vs.forEach(v => { const g = gById[v.game_id], u = byId[v.user_id]; if (g && u) g[v.kind === 'like' ? 'likes' : v.kind === 'dislike' ? 'dislikes' : 'favs'].push(u.name); });
  const [fs_] = await pool.query('SELECT * FROM friendships'), [rq] = await pool.query('SELECT * FROM friend_requests');
  fs_.forEach(r => { const a = byId[r.user_a], b = byId[r.user_b]; if (!a || !b) return; (db.friends[key(a.name)] = db.friends[key(a.name)] || []).push(b.name); (db.friends[key(b.name)] = db.friends[key(b.name)] || []).push(a.name); });
  rq.forEach(r => { const f = byId[r.from_id], t = byId[r.to_id]; if (f && t) (db.req[key(t.name)] = db.req[key(t.name)] || []).push(f.name); });
  const [ms] = await pool.query('SELECT * FROM messages ORDER BY id');
  ms.forEach(r => {
    const s = byId[r.sender_id], t = byId[r.receiver_id]; if (!s || !t) return;
    const pk = pairKey(s.name, t.name), m = { u: s.name, m: r.body, t: +r.sent_ms }; if (r.reply_user) m.r = { u: r.reply_user, m: r.reply_text || '', t: +r.reply_ms };
    (dms[pk] = dms[pk] || []).push(m); if (dms[pk].length > 300) dms[pk].shift(); H.dm[pk] = Math.max(H.dm[pk] || 0, m.t);
  });
  const [rd] = await pool.query('SELECT * FROM dm_reads');
  rd.forEach(r => { const u = byId[r.user_id], o = byId[r.other_id]; if (!u || !o) return; const pk = pairKey(u.name, o.name); ((dms._st = dms._st || {})[pk] = dms._st[pk] || {})[key(u.name)] = +r.read_ms; H.rd[pk + '|' + key(u.name)] = +r.read_ms; });
  const [bs] = await pool.query('SELECT * FROM bans ORDER BY id'), J = t => { try { return JSON.parse(t) || []; } catch (e) { return []; } };
  db.bans = bs.map(r => ({ id: r.id, type: r.type, user: r.user_key || '', username: r.username || '', email: r.email || '', hw: J(r.hw), dv: J(r.dv), ip: J(r.ip), reason: r.reason || '', until: +r.until_ms, created: +r.created_ms, by: r.by_name || '', amount: r.amount || 0, unit: r.unit || '' }));
  const [dv] = await pool.query('SELECT * FROM user_devices ORDER BY id'); db.devices = {};
  dv.forEach(r => { const u = byId[r.user_id]; if (u) (db.devices[key(u.name)] = db.devices[key(u.name)] || []).push({ hw: r.hw || '', dv: r.dv || '', ip: r.ip || '', t: +r.last_ms }); });
  H.bans = md5(JSON.stringify(db.bans)); H.dev = md5(JSON.stringify(Object.keys(db.devices).sort().map(k => [k, db.devices[k].map(d => [d.hw, d.dv, d.ip])])));
  return { db, dms, seen, bans: db.bans, devices: db.devices };
}

/* ---------- gravar mudanças ---------- */
async function syncDb(db) {
  const nh = { users: {}, games: {}, votes: {} }, c = await pool.getConnection(), idOf = n => (db.users[key(n)] || {}).id;
  try {
    await c.beginTransaction();
    for (const k of Object.keys(H.uid)) if (!db.users[k]) { await c.query('DELETE FROM users WHERE id=?', [H.uid[k]]); nh.gone = (nh.gone || []).concat(k); }   // conta apagada (ban permanente)
    for (const k in db.users) {
      const u = db.users[k], a = u.avatar || {}, h = md5(JSON.stringify([u.id, u.name, u.email, u.hash, u.bio, a, u.created, !!u.verified, !!u.admin]));
      if (H.users[k] === h) continue;
      await c.query('INSERT INTO users (id,username,email,password_hash,bio,av_head,av_torso,av_arms,av_legs,created_ms,verified,is_admin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE username=VALUES(username),email=VALUES(email),password_hash=VALUES(password_hash),bio=VALUES(bio),av_head=VALUES(av_head),av_torso=VALUES(av_torso),av_arms=VALUES(av_arms),av_legs=VALUES(av_legs),verified=VALUES(verified),is_admin=VALUES(is_admin)',
        [u.id, u.name, u.email || '', u.hash, u.bio || '', a.head || null, a.torso || null, a.arms || null, a.legs || null, u.created || Date.now(), u.verified ? 1 : 0, u.admin ? 1 : 0]);
      nh.users[k] = h; nh.uid = nh.uid || {}; nh.uid[k] = u.id;
    }
    const live = new Set();
    for (const g of db.games) {
      const cid = idOf(g.creator); if (!cid) continue; const gk = cid + '|' + g.name; live.add(gk);
      const h = md5(JSON.stringify([g.blocks, g.desc, g.serverSize, g.genre, g.vip, g.visits, g.created, g.updated, g.thumb, g.parts]));
      if (H.games[gk] !== h) {
        await c.query('INSERT INTO games (creator_id,name,description,server_size,genre,vip,visits,blocks,parts,thumb,created_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE description=VALUES(description),server_size=VALUES(server_size),genre=VALUES(genre),vip=VALUES(vip),visits=VALUES(visits),blocks=VALUES(blocks),parts=VALUES(parts),thumb=VALUES(thumb),updated_ms=VALUES(updated_ms)',
          [cid, g.name, g.desc || '', g.serverSize || 20, g.genre || 'Outro', g.vip ? 1 : 0, g.visits || 0, g.blocks || 0, JSON.stringify(g.parts || []), g.thumb || null, g.created || Date.now(), g.updated || Date.now()]);
        nh.games[gk] = h;
      }
      const vh = JSON.stringify([g.likes || [], g.dislikes || [], g.favs || []]);
      if (H.votes[gk] !== vh) {
        const [[row]] = await c.query('SELECT id FROM games WHERE creator_id=? AND name=?', [cid, g.name]);
        if (row) {
          await c.query('DELETE FROM game_votes WHERE game_id=?', [row.id]);
          const rows = []; [['like', g.likes], ['dislike', g.dislikes], ['fav', g.favs]].forEach(([kd, l]) => (l || []).forEach(n => { const uid = idOf(n); if (uid) rows.push([row.id, uid, kd]); }));
          if (rows.length) await c.query('INSERT IGNORE INTO game_votes (game_id,user_id,kind) VALUES ?', [rows]);
          nh.votes[gk] = vh;
        }
      }
    }
    const gone = Object.keys(H.games).filter(k => !live.has(k));
    for (const gk of gone) { const [cid, ...nm] = gk.split('|'); await c.query('DELETE FROM games WHERE creator_id=? AND name=?', [+cid, nm.join('|')]); }
    const pairs = new Set(); for (const k in db.friends) (db.friends[k] || []).forEach(n => { const a = idOf(db.users[k] && db.users[k].name), b = idOf(n); if (a && b && a !== b) pairs.add(Math.min(a, b) + ',' + Math.max(a, b)); });
    const fr = [...pairs].sort().join(';'); let frNew = null;
    if (fr !== H.fr) { await c.query('DELETE FROM friendships'); if (pairs.size) await c.query('INSERT INTO friendships (user_a,user_b) VALUES ?', [[...pairs].map(s => s.split(',').map(Number))]); frNew = fr; }
    const rqs = new Set(); for (const k in db.req) (db.req[k] || []).forEach(n => { const f = idOf(n), t = idOf(db.users[k] && db.users[k].name); if (f && t) rqs.add(f + ',' + t); });
    const rq = [...rqs].sort().join(';'); let rqNew = null;
    if (rq !== H.rq) { await c.query('DELETE FROM friend_requests'); if (rqs.size) await c.query('INSERT INTO friend_requests (from_id,to_id) VALUES ?', [[...rqs].map(s => s.split(',').map(Number))]); rqNew = rq; }
    const bh = md5(JSON.stringify(db.bans || [])); let bhNew = null;
    if (bh !== H.bans) {
      await c.query('DELETE FROM bans');
      const rows = (db.bans || []).map(x => [x.id, x.type, x.user || null, x.username || null, x.email || null, JSON.stringify(x.hw || []), JSON.stringify(x.dv || []), JSON.stringify(x.ip || []), x.reason || '', x.until || 0, x.created || Date.now(), x.by || null, x.amount || null, x.unit || null]);
      if (rows.length) await c.query('INSERT INTO bans (id,type,user_key,username,email,hw,dv,ip,reason,until_ms,created_ms,by_name,amount,unit) VALUES ?', [rows]);
      bhNew = bh;
    }
    const dh = md5(JSON.stringify(Object.keys(db.devices || {}).sort().map(k => [k, db.devices[k].map(d => [d.hw, d.dv, d.ip])]))); let dhNew = null;
    if (dh !== H.dev) {
      await c.query('DELETE FROM user_devices');
      const rows = []; for (const k in db.devices || {}) { const u = db.users[k]; if (u) db.devices[k].forEach(d => rows.push([u.id, d.hw || null, d.dv || null, d.ip || null, d.t || Date.now()])); }
      if (rows.length) await c.query('INSERT INTO user_devices (user_id,hw,dv,ip,last_ms) VALUES ?', [rows]);
      dhNew = dh;
    }
    await c.commit();
    if (bhNew !== null) H.bans = bhNew; if (dhNew !== null) H.dev = dhNew;
    (nh.gone || []).forEach(k => { delete H.users[k]; delete H.uid[k]; }); Object.assign(H.uid, nh.uid || {});
    Object.assign(H.users, nh.users); Object.assign(H.games, nh.games); Object.assign(H.votes, nh.votes); gone.forEach(k => { delete H.games[k]; delete H.votes[k]; });
    if (frNew !== null) H.fr = frNew; if (rqNew !== null) H.rq = rqNew;
  } catch (e) { try { await c.rollback(); } catch (x) {} throw e; } finally { c.release(); }
}
async function syncDms(dms, db) {
  const c = await pool.getConnection(), idOf = n => (db.users[key(n)] || {}).id, nd = {}, nr = {};
  try {
    await c.beginTransaction();
    for (const pk in dms) {
      if (pk === '_st' || !Array.isArray(dms[pk])) continue;
      const last = H.dm[pk] || 0, fresh = dms[pk].filter(m => m.t > last), [ka, kb] = pk.split('|'); if (!fresh.length) continue;
      const rows = []; fresh.forEach(m => { const s = idOf(m.u), r = idOf(key(m.u) === ka ? kb : ka); if (s && r) rows.push([s, r, String(m.m).slice(0, 500), m.r ? m.r.u : null, m.r ? m.r.m : null, m.r ? m.r.t : null, m.t]); });
      if (rows.length) await c.query('INSERT INTO messages (sender_id,receiver_id,body,reply_user,reply_text,reply_ms,sent_ms) VALUES ?', [rows]);
      nd[pk] = Math.max(...fresh.map(m => m.t));
    }
    for (const pk in (dms._st || {})) for (const uk in dms._st[pk]) {
      const ts = dms._st[pk][uk], hk = pk + '|' + uk; if (H.rd[hk] === ts) continue;
      const [ka, kb] = pk.split('|'), u = idOf(uk), o = idOf(uk === ka ? kb : ka);
      if (u && o) { await c.query('INSERT INTO dm_reads (user_id,other_id,read_ms) VALUES (?,?,?) ON DUPLICATE KEY UPDATE read_ms=VALUES(read_ms)', [u, o, ts]); nr[hk] = ts; }
    }
    await c.commit(); Object.assign(H.dm, nd); Object.assign(H.rd, nr);
  } catch (e) { try { await c.rollback(); } catch (x) {} throw e; } finally { c.release(); }
}
async function syncSeen(seen, db) {
  const ch = Object.keys(seen).filter(k => db.users[k] && Math.floor(seen[k] / 1000) !== H.seen[k]);
  for (const k of ch) { await pool.query('UPDATE users SET last_seen_ms=? WHERE id=?', [seen[k], db.users[k].id]); H.seen[k] = Math.floor(seen[k] / 1000); }
}

/* ---------- agendador ---------- */
function attach(getters) { ctx = getters; setInterval(flush, 1000).unref(); setInterval(() => { dirty.seen = true; }, 15000).unref(); }
function mark(what) { dirty[what] = true; }
async function flush() {
  if (!pool || !ctx || busy) return; busy = true;
  try {
    const db = ctx.db();
    if (dirty.db) { dirty.db = false; try { await syncDb(db); } catch (e) { dirty.db = true; log('erro ao gravar contas/mapas:', e.message); } }
    if (dirty.dms) { dirty.dms = false; try { await syncDms(ctx.dms(), db); } catch (e) { dirty.dms = true; log('erro ao gravar mensagens:', e.message); } }
    if (dirty.seen) { dirty.seen = false; try { await syncSeen(ctx.seen(), db); } catch (e) { log('erro ao gravar "visto por último":', e.message); } }
  } finally { busy = false; }
}
async function importFirst() { dirty.db = dirty.dms = dirty.seen = true; await flush(); }   // primeira vez: manda o que já existia (data.json / dms.json) para o banco
module.exports = { init, load, attach, mark, flush, importFirst, config: () => cfg, mode: () => (pool ? 'mysql' : 'json') };
