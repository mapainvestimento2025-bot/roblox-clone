// ============================================================
//  _db.js — Proxy da Vercel para a API PHP do ProFreeHost
//
//  Configure na Vercel em Settings > Environment Variables:
//    PROFREEHOST_API = https://brplaybox.unaux.com/api.php
//
//  (sem pasta /api/ — o api.php fica na raiz do ProFreeHost)
// ============================================================

function getApiUrl() {
  const url = process.env.PROFREEHOST_API;
  if (!url) {
    throw new Error(
      'Variável PROFREEHOST_API não configurada na Vercel. ' +
      'Vá em Settings > Environment Variables e adicione: ' +
      'PROFREEHOST_API = https://brplaybox.unaux.com/api.php'
    );
  }
  return url.replace(/\/$/, '');
}

export async function phpGet(action, params = {}) {
  const base = getApiUrl();
  const qs   = new URLSearchParams({ action, ...params }).toString();
  const r    = await fetch(`${base}?${qs}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`PHP GET /${action} retornou ${r.status}: ${text.slice(0, 300)}`);
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
    const text = await r.text().catch(() => '');
    throw new Error(`PHP POST /${action} retornou ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

export function json(res, data, status = 200) {
  res.status(status).json(data);
}

export function err(res, msg, status = 400) {
  res.status(status).json({ err: msg });
}
