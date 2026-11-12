const { phpPost } = require('./_db.js');
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { return res.status(200).json(await phpPost('join', req.body || {})); }
  catch (e) { return res.status(500).json({ err: e.message }); }
};
