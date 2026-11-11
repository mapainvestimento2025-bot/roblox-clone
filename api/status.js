const { phpGet } = require('./_db.js');
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { return res.status(200).json(await phpGet('status', { me: req.query?.me || '', users: req.query?.users || '' })); }
  catch (e) { return res.status(500).json({ err: e.message }); }
};
