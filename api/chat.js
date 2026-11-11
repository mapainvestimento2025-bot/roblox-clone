import { phpGet, phpPost } from './_db.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'POST') return res.status(200).json(await phpPost('chat', req.body || {}));
    return res.status(200).json(await phpGet('chat', { map: req.query?.map || '', after: req.query?.after || '0' }));
  } catch (e) { return res.status(500).json({ err: e.message }); }
}
