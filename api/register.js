import { phpPost } from './_db.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await phpPost('register', req.body || {});
    return res.status(data.err ? 400 : 200).json(data);
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
}
