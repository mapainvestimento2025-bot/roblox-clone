import { phpPost } from './_db.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await phpPost('login', req.body || {});
    return res.status(data.err ? 401 : 200).json(data);
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
