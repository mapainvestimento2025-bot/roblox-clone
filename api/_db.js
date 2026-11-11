// _db.js — Proxy da Vercel para a API PHP do ProFreeHost
// Variável na Vercel: PROFREEHOST_API = https://brplaybox.unaux.com/api.php

function getApiUrl() {
  const url = process.env.PROFREEHOST_API;
  if (!url) throw new Error('PROFREEHOST_API não configurada nas variáveis de ambiente da Vercel.');
  return url.replace(/\/$/, '');
}

export async function phpGet(action, params = {}) {
  const base = getApiUrl();
  const qs   = new URLSearchParams({ action, ...params }).toString();
  const r    = await fetch(`${base}?${qs}`);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`PHP GET ${action} => ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

export async function phpPost(action, body = {}) {
  const base = getApiUrl();
  const r    = await fetch(`${base}?action=${encodeURIComponent(action)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`PHP POST ${action} => ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}
