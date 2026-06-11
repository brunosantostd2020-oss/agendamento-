// Limitador de requisições em memória — sem dependências externas.
// Protege rotas sensíveis (login, cadastro) contra força bruta.
// Obs: server.js usa app.set('trust proxy', 1), então req.ip é o IP real no Railway.

const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 5, msg = 'Muitas tentativas. Aguarde um pouco e tente novamente.' } = {}) {
  return (req, res, next) => {
    const key = `${req.ip || 'desconhecido'}|${req.baseUrl}${req.path}`;
    const agora = Date.now();
    let b = buckets.get(key);
    if (!b || agora - b.inicio > windowMs) {
      b = { inicio: agora, count: 0 };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      return res.status(429).json({ erro: msg });
    }
    next();
  };
}

// Limpeza periódica para não acumular memória
setInterval(() => {
  const agora = Date.now();
  for (const [k, b] of buckets) {
    if (agora - b.inicio > 10 * 60_000) buckets.delete(k);
  }
}, 10 * 60_000).unref();

module.exports = { rateLimit };
