/* server.js - servidor local (sem dependências). Uso:  node server.js  ->  http://localhost:3000
   - serve os arquivos do jogo
   - guarda contas, amigos, pedidos de amizade e mapas em data.json (compartilhado por todos os navegadores/PCs)
   - conta jogadores online e sincroniza a posição dos personagens no mapa */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), store = require('./store');
const PORT = process.env.PORT || 3000, TTL = 75000, presence = {}, world = {}, locks = {};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/* ---------- utilitários básicos (precisam vir ANTES de qualquer código que rode na inicialização, como ensureAdmins()) ---------- */
const key = n => String(n || '').trim().toLowerCase();
const pairKey = (a, b) => [key(a), key(b)].sort().join('|');
const has = (l, n) => (l || []).some(x => x.toLowerCase() === n.toLowerCase());
const without = (l, n) => (l || []).filter(x => x.toLowerCase() !== n.toLowerCase());

/* ---------- banco de dados (arquivo data.json) ---------- */
const DB_FILE = path.join(__dirname, 'data.json');
let db = { users: {}, games: [], friends: {}, req: {}, v: 1, bans: [], devices: {} };
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
/* migra mapas antigos (de antes dos campos descrição/servidor/gênero/vip/visitas) */
(db.games || []).forEach(g => {
  if (g.created === undefined) g.created = g.t || Date.now();
  if (g.updated === undefined) g.updated = g.t || g.created;
  if (g.visits === undefined) g.visits = 0;
  if (g.desc === undefined) g.desc = '';
  if (g.serverSize === undefined) g.serverSize = 20;
  if (g.genre === undefined) g.genre = 'Outro';
  if (g.vip === undefined) g.vip = false;
});
/* mensagens privadas entre amigos ficam em dms.json (separado, para não recarregar o data.json de todo mundo a cada mensagem) */
const DM_FILE = path.join(__dirname, 'dms.json'); let dms = {}, dmTimer = null;
try { dms = JSON.parse(fs.readFileSync(DM_FILE, 'utf8')); } catch (e) {}
const saveDms = () => { store.mark('dms'); clearTimeout(dmTimer); dmTimer = setTimeout(() => fs.writeFile(DM_FILE, JSON.stringify(dms), () => {}), 400); };
const SEEN_FILE = path.join(__dirname, 'seen.json'); let seen = {};   // ukey -> última atividade (app aberto em qualquer página); gravado em seen.json para o "visto por último" sobreviver a reinícios
try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')) || {}; } catch (e) {}
setInterval(() => fs.writeFile(SEEN_FILE, JSON.stringify(seen), () => {}), 15000).unref();
const ONLINE_MS = 35000;
function lastActive(ukey, name) {                    // última atividade conhecida; sem registro (ex.: servidor recém-atualizado) usa a última mensagem enviada pela pessoa
  let t = seen[ukey] || 0;
  if (!t) for (const pk in dms) { if (pk === '_st' || !Array.isArray(dms[pk])) continue; for (const m of dms[pk]) if (m.u && key(m.u) === ukey && m.t > t) t = m.t; }
  return t;
}
function gameOf(ukey) {                              // nome do mapa em que a pessoa está jogando agora (ou null)
  const now = Date.now();
  for (const m in presence) for (const u in presence[m]) if (key(u) === ukey && now - presence[m][u] < 30000) return m.split('#')[0].split('|')[0];
  return null;
}
const readTs = () => (dms._st = dms._st || {});       // dms._st[par][ukey] = até quando essa pessoa LEU a conversa (guardado)
function tickOf(pk, to, t) {                          // 'read' | 'delivered' | 'sent' para uma mensagem enviada para `to`
  const r = (dms._st && dms._st[pk] && dms._st[pk][key(to)]) || 0;
  return r >= t ? 'read' : (seen[key(to)] || 0) >= t ? 'delivered' : 'sent';
}
const chats = {}, lastSend = {}; let chatId = Date.now();           // chat do mapa: só na memória, por servidor (mapa#N)
let saveTimer = null;
function save() { db.v++; store.mark('db'); clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 300); }   // data.json = cópia de segurança; o banco principal é o MySQL
/* ID único de cada conta (1, 2, 3...) */
const nextId = () => Object.values(db.users).reduce((m, u) => Math.max(m, u.id || 0), 0) + 1;
function fixIds() { Object.values(db.users).filter(u => !u.id).sort((a, b) => (a.created || 0) - (b.created || 0)).forEach(u => { u.id = nextId(); }); }
fixIds();
/* ---------- ADMIN / VERIFICADO / BANIMENTOS ---------- */
let ADMINS = []; try { ADMINS = (JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).admins || []).map(key); } catch (e) {}
const isAdmin = u => !!u && (!!u.admin || ADMINS.includes(key(u.name)));
function ensureAdmins() {                           // sem nenhum admin? a conta de menor ID vira admin (o dono do site)
  db.bans = db.bans || []; db.devices = db.devices || {};
  const us = Object.values(db.users); if (us.length && !us.some(isAdmin)) us.sort((a, b) => a.id - b.id)[0].admin = true;
}
ensureAdmins();
const nextBanId = () => (db.bans || []).reduce((m, b) => Math.max(m, b.id || 0), 0) + 1;
const fmtDT = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const banText = b => (b.type === 'perm' ? 'Você foi banido permanentemente.' : b.type === 'hwid' ? 'Este dispositivo foi banido.' : b.type === 'email' ? 'Este e-mail foi banido.' : b.type === 'ip' ? 'Seu endereço IP foi banido.' : 'Sua conta foi banida até ' + fmtDT(b.until) + '.') + (b.reason ? ' Motivo: ' + b.reason : '');
const banView = b => b && { id: b.id, type: b.type, reason: b.reason || '', until: b.until || 0, text: banText(b) };
function devKeys(ukey, b) {                         // identificação do dispositivo = o que ele mandou agora + tudo que já usou nesta conta
  const hw = new Set(), dv = new Set(), ip = new Set();
  const add = d => { if (d.hw) hw.add(d.hw); if (d.dv) dv.add(d.dv); if (d.ip) ip.add(d.ip); };
  add({ hw: okHw(b.hw), dv: okHw(b.dv), ip: b._ip }); ((db.devices || {})[ukey] || []).forEach(add);
  return { hw, dv, ip };
}
const okHw = v => typeof v === 'string' && /^[a-f0-9]{16,64}$/i.test(v) ? v.toLowerCase() : '';
function banFor(b) {                                // retorna o banimento que vale agora para essa pessoa/dispositivo (ou null)
  const now = Date.now(), uk = key(b.user || b.name || ''), u = db.users[uk], email = String(b.email || (u && u.email) || '').toLowerCase(), D = devKeys(uk, b);
  for (const x of db.bans || []) {
    if (x.until && x.until <= now) continue;
    if (x.type === 'temp' && x.user === uk) return x;
    if (x.type === 'email' && email && x.email === email) return x;
    if (x.type === 'perm' && ((email && x.email === email) || (x.user && x.user === uk && !u))) return x;
    if (x.type === 'ip' && b._ip && x.ip && (Array.isArray(x.ip) ? x.ip.includes(b._ip) : x.ip === b._ip)) return x;
    if (x.type === 'hwid' && ((x.hw || []).some(h => D.hw.has(h)) || (x.dv || []).some(h => D.dv.has(h)) || (x.ip || []).some(h => D.ip.has(h)))) return x;
  }
  return null;
}
function rememberDevice(u, b) {
  const h = okHw(b.hw), d = okHw(b.dv), ip = b._ip || '';
  const mobile = !!(b.mobile);
  const info = b.info && typeof b.info === 'object' ? b.info : {};
  if (!u || (!h && !d)) return;
  const l = (db.devices[key(u.name)] = db.devices[key(u.name)] || []);
  const ex = l.find(x => x.hw === h && x.dv === d);
  if (ex) {
    // Atualiza IP atual e mantém histórico de IPs únicos
    if (ip && ip !== '127.0.0.1' && ip !== '::1') {
      ex.ip = ip;
      if (!ex.ipHistory) ex.ipHistory = [];
      if (!ex.ipHistory.includes(ip)) { ex.ipHistory.push(ip); if (ex.ipHistory.length > 10) ex.ipHistory.shift(); }
    }
    ex.t = Date.now();
    // Atualiza info mas preserva campos que já tinham valor se o novo estiver vazio
    if (info && typeof info === 'object') {
      for (const k of Object.keys(info)) {
        if (info[k] !== undefined && info[k] !== null && info[k] !== '' && info[k] !== 0) {
          ex.info[k] = info[k];
        }
      }
    }
    ex.mobile = mobile;
    store.mark('db'); saveSoon(); return;
  }
  const newDev = { hw: h, dv: d, ip, ipHistory: ip ? [ip] : [], mobile, info, t: Date.now() };
  l.push(newDev);
  if (l.length > 30) l.shift();
  store.mark('db'); db.v++; saveSoon();
}
let saveT2 = null; const saveSoon = () => { clearTimeout(saveT2); saveT2 = setTimeout(save, 500); };
function deleteAccount(u) {                         // ban permanente: apaga a conta e tudo que é dela
  const k = key(u.name);
  delete db.users[k]; delete db.devices[k]; delete db.friends[k]; delete db.req[k]; delete seen[k];
  for (const x in db.friends) db.friends[x] = (db.friends[x] || []).filter(n => key(n) !== k);
  for (const x in db.req) db.req[x] = (db.req[x] || []).filter(n => key(n) !== k);
  db.games = db.games.filter(x => key(x.creator) !== k);
  db.games.forEach(g => ['likes', 'dislikes', 'favs'].forEach(f => { g[f] = (g[f] || []).filter(n => key(n) !== k); }));
  for (const pk of Object.keys(dms)) if (pk !== '_st' && pk.split('|').includes(k)) delete dms[pk]; if (dms._st) for (const pk of Object.keys(dms._st)) if (pk.split('|').includes(k)) delete dms._st[pk];
  for (const m in presence) delete presence[m][u.name]; for (const m in world) delete world[m][u.name];
  saveDms();
}
function adminOp(b) {                               // painel de administração (exige senha de um admin em cada chamada)
  const me = db.users[key(b.user)];
  if (!me || me.hash !== b.hash || !isAdmin(me)) return { err: 'Acesso negado. Entre com uma conta de administrador.' };
  const now = Date.now(), target = db.users[key(b.target)];
  const view = () => ({
    ok: true, me: { id: me.id, name: me.name },
    users: Object.values(db.users).sort((a, c) => a.id - c.id).map(u => { const bn = banFor({ user: u.name }); const devs = (db.devices || {})[key(u.name)] || []; const uGames = db.games.filter(g => g.creator === u.name); const totalParts = uGames.reduce((s, g) => s + (g.blocks || g.parts && g.parts.length || 0), 0); const totalVisits = uGames.reduce((s, g) => s + (g.visits || 0), 0); /* monta lista de devices com info para o admin */ const deviceList = devs.map(dv => ({ hw: dv.hw, dv: dv.dv, ip: dv.ip, ipHistory: dv.ipHistory || (dv.ip ? [dv.ip] : []), mobile: dv.mobile, t: dv.t, info: dv.info || {} })); return { id: u.id, name: u.name, email: u.email, verified: !!u.verified, admin: isAdmin(u), created: u.created, seen: seen[key(u.name)] || 0, devices: devs.length, mobile: devs.some(d => d.mobile), deviceList, ban: bn ? banView(bn) : null, games: uGames.map(g => ({ name: g.name, blocks: g.blocks || (g.parts ? g.parts.length : 0), visits: g.visits || 0, genre: g.genre || '', created: g.created || g.t || 0 })), totalParts, totalVisits }; }),
    bans: (db.bans || []).filter(x => !x.until || x.until > now).sort((a, c) => c.created - a.created)
  });
  if (b.op === 'list') return view();
  if (b.op === 'verify') { if (!target) return { err: 'Usuário não encontrado.' }; target.verified = !!b.on; save(); return view(); }
  if (b.op === 'admin') { if (!target) return { err: 'Usuário não encontrado.' }; if (target === me && !b.on) return { err: 'Você não pode remover o seu próprio admin.' }; target.admin = !!b.on; save(); return view(); }
  if (b.op === 'unban') { db.bans = (db.bans || []).filter(x => x.id !== +b.id); save(); return view(); }
  if (b.op === 'ban') {
    const kind = b.kind, reason = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200), email = String(b.email || (target && target.email) || '').trim().toLowerCase();
    if (target && (target === me || isAdmin(target))) return { err: 'Não é possível banir um administrador.' };
    if (!target && kind !== 'email') return { err: 'Usuário não encontrado.' };
    if (!target && !/^\S+@\S+\.\S+$/.test(email)) return { err: 'Digite um e-mail válido.' };
    const base = { id: nextBanId(), reason, created: now, by: me.name, user: target ? key(target.name) : '', username: target ? target.name : '', email };
    if (kind === 'hours' || kind === 'days') {
      const n = Math.floor(+b.amount), max = kind === 'hours' ? 24 : 365;
      if (!(n >= 1 && n <= max)) return { err: 'Escolha de 1 a ' + max + (kind === 'hours' ? ' horas.' : ' dias.') };
      db.bans.push({ ...base, type: 'temp', amount: n, unit: kind, until: now + n * (kind === 'hours' ? 3600e3 : 864e5) });
    } else if (kind === 'email') {
      if (db.bans.some(x => x.type === 'email' && x.email === email && !x.until)) return { err: 'Esse e-mail já está banido.' };
      db.bans.push({ ...base, type: 'email', until: 0 });
    } else if (kind === 'ip') {
      const manualIp = String(b.manualIp || '').trim(); if (!manualIp) return { err: 'Digite o endereço IP.' };
      if (db.bans.some(x => x.type === 'ip' && (Array.isArray(x.ip) ? x.ip.includes(manualIp) : x.ip === manualIp) && !x.until)) return { err: 'Esse IP já está banido.' };
      db.bans.push({ ...base, type: 'ip', ip: [manualIp], until: 0 });
    } else if (kind === 'hwid') {
      const D = devKeys(key(target.name), {}); if (!D.hw.size && !D.dv.size) return { err: 'Nenhum dispositivo conhecido deste usuário (ele ainda não entrou com esta versão do site).' };
      db.bans.push({ ...base, type: 'hwid', hw: [...D.hw], dv: [...D.dv], ip: b.ip ? [...D.ip].filter(Boolean) : [], until: 0 });
    } else if (kind === 'perm') {
      const D = devKeys(key(target.name), {});
      db.bans.push({ ...base, type: 'perm', until: 0 });                                                           // e-mail fica bloqueado para sempre
      if (b.device !== false && (D.hw.size || D.dv.size)) db.bans.push({ ...base, id: nextBanId(), type: 'hwid', hw: [...D.hw], dv: [...D.dv], ip: [], until: 0, reason: reason || 'Ban permanente' });
      deleteAccount(target);
    } else return { err: 'Tipo de ban inválido.' };
    save(); return view();
  }
  return { err: 'Operação inválida.' };
}
function pub() {                                     // versão pública: SEM senha (hash) e SEM e-mail
  const users = {};
  for (const k in db.users) { const u = db.users[k]; users[k] = { id: u.id, name: u.name, created: u.created, avatar: u.avatar || null, bio: u.bio || '', verified: !!u.verified, admin: isAdmin(u) }; }
  return { v: db.v, db: { users, games: db.games, friends: db.friends, req: db.req } };
}
const cleanBio = t => String(t || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 300);
const okColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const okAv = av => av && typeof av === 'object' && ['head', 'torso', 'arms', 'legs'].every(k => okColor(av[k])) ? { head: av.head, torso: av.torso, arms: av.arms, legs: av.legs } : null;
const GENRES = ['Aventura', 'RPG', 'Simulador', 'Luta', 'Terror', 'Corrida', 'Plataforma', 'Construção', 'Obstáculos (Obby)', 'Social', 'Outro'];
const okGame = (g, creator) => g && typeof g.name === 'string' && g.name.trim() && g.name.length <= 40 && Array.isArray(g.parts) && g.parts.length <= 5000 &&
  (!g.thumb || (typeof g.thumb === 'string' && g.thumb.startsWith('data:image/') && g.thumb.length < 250000)) &&
  (g.desc === undefined || (typeof g.desc === 'string' && g.desc.length <= 400)) &&
  (g.serverSize === undefined || (typeof g.serverSize === 'number' && isFinite(g.serverSize))) &&
  (g.genre === undefined || typeof g.genre === 'string') &&
  (g.vip === undefined || typeof g.vip === 'boolean');
function addGame(g, creator) {
  const name = g.name.trim();
  const old = db.games.find(x => x.name === name && x.creator === creator);
  const clean = {
    name, creator,
    blocks: g.parts.length - 1 > 0 ? g.parts.length - 1 : g.parts.length,
    parts: g.parts, thumb: g.thumb || '',
    desc: (g.desc || '').trim().slice(0, 400),
    serverSize: g.serverSize && g.serverSize >= 1 ? Math.min(200, Math.round(g.serverSize)) : 20,
    genre: GENRES.includes(g.genre) ? g.genre : 'Outro',
    vip: !!g.vip,
    created: old ? (old.created || old.t || Date.now()) : Date.now(),  // nunca muda depois de criado
    updated: Date.now(),                                                // sempre que o mapa é postado de novo
    visits: old ? (old.visits || 0) : 0,                                 // total de visitas preservado
    likes: old ? (old.likes || []) : [], dislikes: old ? (old.dislikes || []) : [], favs: old ? (old.favs || []) : [],   // votos preservados
    t: old ? (old.t || old.created) : Date.now()                        // compatibilidade com versões antigas
  };
  db.games = db.games.filter(x => !(x.name === name && x.creator === creator)); db.games.push(clean);
}

function api(p, b) {                                  // retorna objeto de resposta
  if (p === '/api/register') {
    const name = String(b.name || '').trim(), k = key(name), email = String(b.email || '').toLowerCase();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { err: 'Usuário: 3 a 20 letras, números ou _ (sem espaços).' };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { err: 'Digite um e-mail válido.' };
    if (typeof b.hash !== 'string' || b.hash.length < 20) return { err: 'Senha inválida.' };
    if (db.users[k]) return { err: 'Esse nome de usuário já está em uso.' };
    if (Object.values(db.users).some(u => u.email === email)) return { err: 'Esse e-mail já está cadastrado.' };
    const bn = banFor({ email, hw: b.hw, dv: b.dv, _ip: b._ip }); if (bn) return { err: banText(bn), ban: banView(bn) };
    db.users[k] = { id: nextId(), name, email, hash: b.hash, created: Date.now() }; ensureAdmins(); rememberDevice(db.users[k], b); save(); return { ok: true, ...pub() };
  }
  if (p === '/api/login') {
    const u = db.users[key(b.name)]; if (!(u && u.hash === b.hash)) return { err: 'Usuário ou senha incorretos.' };
    const bn = banFor({ user: u.name, hw: b.hw, dv: b.dv, _ip: b._ip }); if (bn) return { err: banText(bn), ban: banView(bn) };
    rememberDevice(u, b); return { ok: true, ...pub() };
  }
  if (p === '/api/admin') return adminOp(b);
  if (p === '/api/makeadmin') {
    const secret = process.env.ADMIN_SECRET;
    if (!secret || b.secret !== secret) return { err: 'Chave inválida.' };
    const u = db.users[key(b.user)];
    if (!u) return { err: 'Usuário não encontrado.' };
    u.admin = true; save();
    return { ok: true, msg: u.name + ' agora é admin!' };
  }
  if (p === '/api/bio') { const u = db.users[key(b.user)]; if (u) { u.bio = cleanBio(b.bio); save(); } return pub(); }
  if (p === '/api/avatar') { const u = db.users[key(b.user)], av = okAv(b.avatar); if (u && av) { u.avatar = av; save(); } return pub(); }
  if (p === '/api/friend') {
    const me = db.users[key(b.me)], o = db.users[key(b.other)];
    if (!me || !o || me === o) return pub();
    const mk = key(me.name), ok = key(o.name);
    if (b.op === 'request') { if (!has(db.friends[mk], o.name) && !has(db.req[mk], o.name)) { const l = db.req[ok] = db.req[ok] || []; if (!has(l, me.name)) l.push(me.name); } }
    if (b.op === 'accept') { db.req[mk] = without(db.req[mk], o.name); [[mk, o.name], [ok, me.name]].forEach(([a, n]) => { const f = db.friends[a] = db.friends[a] || []; if (!has(f, n)) f.push(n); }); }
    if (b.op === 'decline') db.req[mk] = without(db.req[mk], o.name);
    if (b.op === 'unfriend') { db.friends[mk] = without(db.friends[mk], o.name); db.friends[ok] = without(db.friends[ok], me.name); }
    save(); return pub();
  }
  if (p === '/api/game') { const u = db.users[key(b.creator)]; if (u && okGame(b.game)) { addGame(b.game, u.name); save(); } return pub(); }
  if (p === '/api/game/delete') { const u = db.users[key(b.creator)]; if (u) { db.games = db.games.filter(x => !(x.name === b.name && x.creator === u.name)); save(); } return pub(); }
  if (p === '/api/game/vote') {                       // curtir / não curtir / favoritar (um voto por conta)
    const u = db.users[key(b.user)], g = db.games.find(x => x.name === String(b.name || '') && x.creator === String(b.creator || ''));
    if (u && g) {
      const L = k => (g[k] = (g[k] || []).filter(n => n !== u.name)), had = k => (g[k] || []).includes(u.name);
      if (b.kind === 'like') { const was = had('likes'); L('likes'); L('dislikes'); if (!was) g.likes.push(u.name); }
      if (b.kind === 'dislike') { const was = had('dislikes'); L('likes'); L('dislikes'); if (!was) g.dislikes.push(u.name); }
      if (b.kind === 'fav') { const was = had('favs'); L('favs'); if (!was) g.favs.push(u.name); }
      save();
    }
    return pub();
  }
  if (p === '/api/game/visit') {
    const g = db.games.find(x => x.name === String(b.name || '') && x.creator === String(b.creator || ''));
    if (g) { g.visits = (g.visits || 0) + 1; save(); }
    return pub();
  }
  if (p === '/api/import') {                          // migra dados que já existiam só no navegador (uma vez)
    Object.entries(b.users || {}).forEach(([k, u]) => { if (u && /^[A-Za-z0-9_]{3,20}$/.test(u.name || '') && !db.users[key(u.name)] && typeof u.hash === 'string' && !Object.values(db.users).some(x => x.email === u.email))
      db.users[key(u.name)] = { id: nextId(), name: u.name, email: String(u.email || '').toLowerCase(), hash: u.hash, created: u.created || Date.now(), avatar: okAv(u.avatar) }; });
    (b.games || []).forEach(g => { const u = db.users[key(g.creator)]; if (u && okGame(g) && !db.games.some(x => x.name === g.name && x.creator === u.name)) addGame(g, u.name); });
    ['friends', 'req'].forEach(t => Object.entries(b[t] || {}).forEach(([k, l]) => { if (db.users[k] && Array.isArray(l)) l.forEach(n => { if (db.users[key(n)] && !has(db[t][k] = db[t][k] || [], db.users[key(n)].name)) db[t][k].push(db.users[key(n)].name); }); }));
    save(); return pub();
  }
  return null;
}

/* ---------- presença e posições ---------- */
function snapshot() {
  const now = Date.now(), out = {};
  for (const m in presence) { for (const u in presence[m]) if (now - presence[m][u] > TTL) delete presence[m][u]; const l = Object.keys(presence[m]); if (l.length) out[m] = l; else delete presence[m]; }
  return out;
}
function worldOf(map) {
  const now = Date.now(), out = {}, w = world[map] || {};
  for (const u in w) { if (now - w[u].t > TTL) { delete w[u]; continue; } const { p, r, w: sp, av, t } = w[u]; out[u] = { p, r, w: sp, av, a: now - t }; }
  return out;
}
const okNum = n => typeof n === 'number' && isFinite(n) && Math.abs(n) < 1e6;
const readBody = (req, max = 5000) => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > max) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); });
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

const ipOf = req => {
  // Render e Railway enviam o IP real no x-forwarded-for
  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
  if (fwd) {
    // Pode vir como "IP_REAL, IP_PROXY1, IP_PROXY2" — pega o primeiro (mais à esquerda = cliente)
    const ips = fwd.split(',').map(s => s.trim()).filter(Boolean);
    // Ignora IPs privados/loopback que podem vir de proxies internos
    const pub = ips.find(ip => !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('172.') && !ip.startsWith('192.168.') && ip !== '::1' && ip !== 'localhost');
    if (pub) return pub;
    if (ips[0]) return ips[0]; // fallback: retorna o primeiro mesmo que privado
  }
  const raw = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return raw || '';
};

/* ---------- sistema de avisos (# nas regras) ---------- */
const warnings = {};  // ukey -> { count, last }
const WARN_WORDS = ['palavrão','merda','puta','foda','viado','racista','fdp','porra','caralho','arrombado','canalha','lixo','odeio','morte','matar','suicídio','hack','hacker','cheat','exploit','cheto','aimbot','esp','wallhack','spam','spammer'];
function checkViolation(text) { const t = text.toLowerCase(); return WARN_WORDS.some(w => t.includes(w)); }
function issueWarning(ukey, source) {
  if (!ukey) return null;
  warnings[ukey] = warnings[ukey] || { count: 0, last: 0 };
  warnings[ukey].count++; warnings[ukey].last = Date.now();
  const n = warnings[ukey].count;
  const msg = `⚠️ Aviso #${n}: sua mensagem violou as regras da plataforma. Reincidências podem resultar em banimento.`;
  // injeta aviso no chat privado (DM) do usuário com o sistema
  const u = db.users[ukey]; if (u) {
    const sk = pairKey(u.name, '__sistema__'); const sl = dms[sk] = dms[sk] || [];
    sl.push({ u: '__sistema__', m: msg, t: Date.now(), sys: true }); if (sl.length > 50) sl.shift(); saveDms();
  }
  return { warned: true, count: n, msg };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/db' && req.method === 'GET') return json(res, +url.searchParams.get('v') === db.v ? { v: db.v, same: true } : pub());
  if (req.method === 'POST' && /^\/api\/(register|login|admin|avatar|bio|friend|game|game\/delete|game\/visit|game\/vote|import)$/.test(url.pathname)) {
    const bd = await readBody(req, 4e6); bd._ip = ipOf(req);
    if (/^\/api\/(game|game\/delete|game\/vote|bio|avatar)$/.test(url.pathname)) { const bn = banFor({ user: bd.creator || bd.user, hw: bd.hw, dv: bd.dv, _ip: bd._ip }); if (bn) return json(res, { err: banText(bn), ban: banView(bn) }); }
    const r = api(url.pathname, bd); return json(res, r || { err: 'inválido' });
  }
  if (url.pathname === '/api/join' && req.method === 'POST') {   // escolhe o servidor (atômico) + trava "1 dispositivo por conta e mapa"
    const b = await readBody(req), now = Date.now();
    if (typeof b.base !== 'string' || typeof b.user !== 'string' || typeof b.tab !== 'string' || b.base.length > 200 || b.user.length > 40 || b.tab.length > 80) return json(res, { err: 'inválido' });
    { const bn = banFor({ user: b.user, _ip: ipOf(req) }); if (bn) return json(res, { err: banText(bn), ban: banView(bn) }); }
    const lk = b.base + '|' + b.user, L = locks[lk], mine = !L || L.tab === b.tab || now - L.t > TTL;
    if (b.op === 'release') { if (L && L.tab === b.tab) delete locks[lk]; return json(res, { ok: true }); }
    if (!mine) return json(res, { busy: true });
    locks[lk] = { tab: b.tab, t: now };
    if (b.op === 'refresh') return json(res, { ok: true });
    const size = Math.max(1, Math.min(200, Math.round(+b.size) || 20)), snap = snapshot(), pre = b.base + '#';
    for (const k in presence) if (k.startsWith(pre) && presence[k][b.user]) delete presence[k][b.user];   // sai de salas antigas
    const fr = (db.friends[key(b.user)] || []).map(n => n.toLowerCase());     // amigo jogando? entra no servidor dele (se tiver vaga)
    let i = -1;
    if (fr.length) Object.keys(snap).filter(k => k.startsWith(pre)).map(k => +k.slice(pre.length)).sort((x, y) => x - y).some(n => {
      const us = snap[pre + n].filter(u => u !== b.user);
      if (us.some(u => fr.includes(u.toLowerCase()))) { i = n; return true; } });
    if (i < 0) { i = 0; while (((snap[pre + i] || []).filter(n => n !== b.user)).length >= size) i++; }
    (presence[pre + i] = presence[pre + i] || {})[b.user] = now;
    return json(res, { idx: i });
  }
  /* ---- chat dentro do mapa (cada servidor tem o seu) ---- */
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const b = await readBody(req), u = db.users[key(b.user)], now = Date.now(), m = String(b.msg || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!u || typeof b.map !== 'string' || b.map.length > 200 || !m) return json(res, { ok: false });
    if (banFor({ user: u.name })) return json(res, { ok: false, banned: true });
    if (now - (lastSend[u.name] || 0) < 400) return json(res, { ok: false, slow: true });
    lastSend[u.name] = now;
    const violated = checkViolation(m);
    const finalMsg = violated ? '# ' + m : m;
    const l = chats[b.map] = chats[b.map] || []; l.push({ id: ++chatId, u: u.name, m: finalMsg, t: now, w: violated || undefined }); if (l.length > 60) l.shift();
    if (violated) {
      const wr = issueWarning(key(u.name), 'chat');
      // também injeta aviso no próprio chat do mapa
      l.push({ id: ++chatId, u: '__sistema__', m: `⚠️ ${u.name} recebeu um aviso (#${wr.count}) por violar as regras.`, t: now + 1, sys: true }); if (l.length > 60) l.shift();
    }
    return json(res, { ok: true, warned: violated || false });
  }
  if (url.pathname === '/api/chat' && req.method === 'GET') {
    const l = chats[url.searchParams.get('map')] || [], after = +url.searchParams.get('after') || 0;
    return json(res, { msgs: l.filter(x => x.id > after), last: l.length ? l[l.length - 1].id : after });
  }
  /* ---- bate-papo privado entre amigos ---- */
  if (url.pathname === '/api/dm' && req.method === 'POST') {
    const b = await readBody(req), me = db.users[key(b.from)], o = db.users[key(b.to)], m = String(b.msg || '').trim().slice(0, 500);
    if (!me || !o || !m || !has(db.friends[key(me.name)], o.name)) return json(res, { ok: false });
    if (banFor({ user: me.name })) return json(res, { ok: false, banned: true });
    const k = pairKey(me.name, o.name), l = dms[k] = dms[k] || []; const msg = { u: me.name, m, t: Date.now() }, q = b.reply;
    if (q && typeof q === 'object' && typeof q.m === 'string' && typeof q.u === 'string' && isFinite(+q.t)) msg.r = { u: q.u.slice(0, 40), m: q.m.slice(0, 100), t: +q.t };   // resposta a uma mensagem
    seen[key(me.name)] = msg.t;
    const dmViolated = checkViolation(m); if (dmViolated) msg.m = '# ' + msg.m.replace(/^# /, ''); msg.w = dmViolated || undefined;
    l.push(msg); if (l.length > 300) l.shift();
    if (dmViolated) issueWarning(key(me.name), 'dm');
    saveDms();
    return json(res, { ok: true, warned: dmViolated || false });
  }
  if (url.pathname === '/api/dm' && req.method === 'GET') {
    const me = db.users[key(url.searchParams.get('me'))], o = db.users[key(url.searchParams.get('other'))];
    if (!me || !o || !has(db.friends[key(me.name)], o.name)) return json(res, { msgs: [] });
    const now = Date.now(), pk = pairKey(me.name, o.name), l = dms[pk] || [], mk = key(me.name), ok = key(o.name);
    seen[mk] = now;
    if (url.searchParams.get('read') === '1' && l.length) {          // conversa aberta e visível = leu tudo até agora
      const st = readTs(), p = st[pk] = st[pk] || {}, lastT = l[l.length - 1].t;
      if ((p[mk] || 0) < lastT) { p[mk] = Math.max(now, lastT); saveDms(); }
    }
    const rd = (dms._st && dms._st[pk] && dms._st[pk][ok]) || 0, sn = seen[ok] || 0;
    return json(res, { msgs: l, st: { r: rd, s: sn, online: now - sn < 12000 } });
  }
  if (url.pathname === '/api/dm/summary' && req.method === 'GET') {
    const me = db.users[key(url.searchParams.get('me'))], out = {};
    if (me) { seen[key(me.name)] = Date.now(); (db.friends[key(me.name)] || []).forEach(f => { const pk = pairKey(me.name, f), l = dms[pk]; if (l && l.length) { const m = l[l.length - 1]; out[f] = Object.assign({}, m, m.u === me.name ? { ts: tickOf(pk, f, m.t) } : {}); } }); }
    return json(res, out);
  }
  if (url.pathname === '/api/health') return json(res, { ok: true, db: store.mode(), users: Object.keys(db.users).length });
  if (url.pathname === '/api/stats') {
    const now = Date.now();
    const totalViews = db.games.reduce((s, g) => s + (g.visits || 0), 0);
    const online = Object.values(db.users).filter(u => now - (seen[key(u.name)] || 0) < ONLINE_MS).length;
    return json(res, { totalViews, online, users: Object.keys(db.users).length });
  }
  if (url.pathname === '/api/warn' && req.method === 'POST') {
    const b = await readBody(req), admin = db.users[key(b.user)];
    if (!admin || admin.hash !== b.hash || !isAdmin(admin)) return json(res, { err: 'Acesso negado.' });
    const target = db.users[key(b.target)]; if (!target) return json(res, { err: 'Usuário não encontrado.' });
    const wr = issueWarning(key(target.name), 'admin');
    // injeta no chat do mapa se informado
    if (b.map) { const l = chats[b.map] = chats[b.map] || []; l.push({ id: ++chatId, u: '__sistema__', m: `⚠️ ${target.name} recebeu um aviso (#${wr.count}) de um administrador.`, t: Date.now(), sys: true }); if (l.length > 60) l.shift(); }
    return json(res, { ok: true, count: wr.count });
  }
  if (url.pathname === '/api/ping' && req.method === 'POST') {
    const b = await readBody(req); b._ip = ipOf(req); const u = typeof b.user === 'string' && db.users[key(b.user)];
    if (u) { const bn = banFor({ user: u.name, hw: b.hw, dv: b.dv, _ip: b._ip }); if (bn) return json(res, { ok: false, ban: banView(bn) }); seen[key(u.name)] = Date.now(); rememberDevice(u, b); }
    return json(res, { ok: true });
  }
  if (url.pathname === '/api/status' && req.method === 'GET') {   // online / jogando / visto por último — o mapa e o horário só aparecem para amigos
    const me = db.users[key(url.searchParams.get('me'))], out = {}, now = Date.now();
    String(url.searchParams.get('users') || '').split(',').slice(0, 80).forEach(n => {
      const o = db.users[key(n)]; if (!o) return; const k = key(o.name), g = gameOf(k), on = !!g || now - (seen[k] || 0) < ONLINE_MS;
      const fr = me && (key(me.name) === k || has(db.friends[key(me.name)], o.name));
      out[o.name] = fr ? { on, g: g || null, s: lastActive(k, o.name) } : { on };
    });
    return json(res, out);
  }
  if (url.pathname === '/api/ban/check' && req.method === 'POST') { const b = await readBody(req); b._ip = ipOf(req); const bn = banFor(b); return json(res, { ban: banView(bn) }); }
  if (url.pathname === '/api/move' && req.method === 'POST') {
    const b = await readBody(req);
    if (typeof b.user === 'string' && banFor({ user: b.user })) return json(res, {});
    if (typeof b.map === 'string' && typeof b.user === 'string' && b.map.length < 200 && b.user.length < 40 && Array.isArray(b.p) && b.p.length === 3 && b.p.every(okNum)) {
      seen[key(b.user)] = Date.now();
      (world[b.map] = world[b.map] || {})[b.user] = { p: b.p, r: okNum(b.r) ? b.r : 0, w: okNum(b.w) ? b.w : 0, av: okAv(b.av), t: Date.now() };
      (presence[b.map] = presence[b.map] || {})[b.user] = Date.now();
    }
    return json(res, worldOf(b.map));
  }
  if (url.pathname.startsWith('/api/presence')) {
    if (req.method === 'POST') {
      const { map, user } = await readBody(req);
      if (typeof map === 'string' && typeof user === 'string' && map.length < 200 && user.length < 40) {
        if (url.pathname.endsWith('/leave')) { if (presence[map]) delete presence[map][user]; if (world[map]) delete world[map][user]; }
        else { (presence[map] = presence[map] || {})[user] = Date.now(); seen[key(user)] = Date.now(); }
      }
    }
    return json(res, snapshot());
  }
  let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
  const file = path.join(__dirname, path.normalize(p));
  if (!file.startsWith(__dirname) || path.basename(file) === 'data.json' || path.basename(file) === 'dms.json' || path.basename(file) === 'seen.json' || ['config.json', 'store.js', 'database.sql', 'package.json', 'package-lock.json'].includes(path.basename(file)) || /(^|[\\/])(node_modules|\.vscode)([\\/]|$)/.test(p) || path.basename(file) === 'config.json' || path.basename(file) === 'store.js' || path.basename(file) === 'server.js') { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end('404 - não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});
/* ---------- inicialização: conecta no MySQL (XAMPP), carrega os dados e só então abre o servidor ---------- */
(async () => {
  const r = await store.init();
  if (r.mode === 'mysql') {
    try {
      const L = await store.load();
      if (L) { db.users = L.db.users; db.games = L.db.games; db.friends = L.db.friends; db.req = L.db.req; db.v = (db.v || 1) + 1; db.bans = L.bans || []; db.devices = L.devices || {}; dms = L.dms; seen = Object.assign(seen, L.seen); fixIds(); ensureAdmins(); }
      store.attach({ db: () => db, dms: () => dms, seen: () => seen });
      if (!L) await store.importFirst();                 // banco vazio: envia o data.json existente para o MySQL
      else store.mark('db');
    } catch (e) { console.log('  [MySQL] erro ao carregar:', e.message); }
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Roblox Clone rodando!\n  Neste PC:   http://localhost:' + PORT);
    Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).forEach(i => console.log('  Na rede:    http://' + i.address + ':' + PORT));
    if (store.mode() === 'mysql') { const c = store.config(); console.log('  Banco de dados: MySQL "' + c.database + '" em ' + c.host + ':' + c.port + '  (' + Object.keys(db.users).length + ' contas)'); }
    else console.log('  Banco de dados: arquivo data.json  (' + (r.why || '') + ')\n  Para usar o MySQL do XAMPP: ligue o MySQL no XAMPP e rode  npm install  uma vez.');
    console.log('  (Ctrl+C para parar)\n');
  });
})();
const bye = async () => { try { ['db', 'dms', 'seen'].forEach(w => store.mark(w)); await store.flush(); } catch (e) {} process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);