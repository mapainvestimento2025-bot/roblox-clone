// keepalive.js — evita que o Render adormeça no plano gratuito
// Importado pelo server.js automaticamente
const https = require('https');
const url = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
if (url) {
  const target = url.startsWith('http') ? url : 'https://' + url;
  const ping = () => {
    https.get(target + '/api/health', r => {
      r.resume();
      console.log(`[keepalive] ping OK ${new Date().toISOString()}`);
    }).on('error', e => console.log(`[keepalive] erro: ${e.message}`));
  };
  // Primeira chamada após 30s, depois a cada 10 minutos
  setTimeout(ping, 30000);
  setInterval(ping, 10 * 60 * 1000);
  console.log('[keepalive] ativo →', target);
}
