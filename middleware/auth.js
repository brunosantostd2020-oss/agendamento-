function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ erro: 'Não autenticado. Faça login.' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ erro: 'Acesso restrito ao administrador.' });
}

module.exports = { requireAuth, requireAdmin };
