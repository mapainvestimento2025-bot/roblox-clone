const { phpGet } = require('../_db.js');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const data = await phpGet('db', { v: req.query?.v || '0' });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ err: e.message });
  }
};
