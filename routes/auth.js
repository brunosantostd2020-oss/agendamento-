const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { enviarBoasVindas, enviarInstrucoesPagamento } = require('../middleware/email');
const { enviarEmail } = require('../middleware/mailer');
const { rateLimit } = require('../middleware/rateLimit');

// Cache em memória para /auth/me — evita query no banco a cada request
const _meCache = new Map();
const ME_TTL   = 30 * 1000; // 30 segundos

function getMeCache(userId) {
  const cached = _meCache.get(userId);
  if (cached && Date.now() - cached.ts < ME_TTL) return cached.data;
  return null;
}
function setMeCache(userId, data) {
  _meCache.set(userId, { data, ts: Date.now() });
  // Limpar cache de usuários inativos (máx 1000 entradas)
  if (_meCache.size > 1000) {
    const oldest = [..._meCache.entries()]
      .sort((a,b) => a[1].ts - b[1].ts)[0];
    _meCache.delete(oldest[0]);
  }
}
function clearMeCache(userId) {
  _meCache.delete(userId);
}

// POST /auth/cadastro
router.post('/cadastro', rateLimit({ windowMs: 10 * 60_000, max: 6, msg: 'Muitos cadastros seguidos. Aguarde alguns minutos.' }), async (req, res) => {
  const { nome, email, senha, nome_negocio, nicho, plano } = req.body;

  if (!nome || !email || !senha || !nome_negocio || !nicho || !plano)
    return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erro: 'E-mail inválido.' });

  if (senha.length < 6)
    return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });

  try {
    // Verifica se e-mail já existe
    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (existe.rows.length > 0)
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });

    // Gera slug único
    const slugBase = nome_negocio.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let slug = slugBase, i = 1;
    while (true) {
      const s = await pool.query('SELECT id FROM usuarios WHERE slug = $1', [slug]);
      if (s.rows.length === 0) break;
      slug = slugBase + '-' + i; i++;
    }

    const hash  = await bcrypt.hash(senha, 6); // custo 6 = rápido e seguro para SaaS
    const agora = new Date().toLocaleString('pt-BR');
    const id    = uuidv4();
    const config = {
      horarios: '08:00,09:00,10:00,11:00,14:00,15:00,16:00,17:00',
      dias_uteis: '0,1,2,3,4,5,6',
      telefone: '', descricao: '', cor: '#0d9488',
      email_negocio: '', email_senha: '',
    };

    const trialExpira = new Date();
    trialExpira.setDate(trialExpira.getDate() + 7);
    const trialStr = trialExpira.toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO usuarios (id, nome, email, senha, nome_negocio, nicho, plano, slug, ativo, criado_em, config, trial_expira, acesso_ativo, plano_pago, acesso_expira)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,true,false,'')`,
      [id, nome.trim(), email.toLowerCase().trim(), hash, nome_negocio.trim(), nicho, plano, slug, agora, JSON.stringify(config), trialStr]
    );

    req.session.userId    = id;
    req.session.userName  = nome.trim();
    req.session.userSlug  = slug;
    req.session.userNicho = nicho;
    req.session.isAdmin   = false;

    // E-mails em background
    Promise.all([
      enviarBoasVindas({ nome: nome.trim(), email: email.toLowerCase(), senha, nomeNegocio: nome_negocio.trim(), nicho, plano, slug }),
      enviarInstrucoesPagamento({ nome: nome.trim(), email: email.toLowerCase(), plano, nomeNegocio: nome_negocio.trim() }),
    ]).catch(e => console.error('Erro emails:', e.message));

    res.status(201).json({ sucesso: true, slug, nicho });
  } catch(e) {
    console.error('Erro cadastro:', e.message);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
});

// POST /auth/login
router.post('/login', rateLimit({ windowMs: 60_000, max: 8, msg: 'Muitas tentativas de login. Aguarde 1 minuto.' }), async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });

  // Admin master — só funciona se as credenciais estiverem configuradas no servidor
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
      email === process.env.ADMIN_EMAIL &&
      senha === process.env.ADMIN_PASSWORD) {
    req.session.userId  = 'admin';
    req.session.isAdmin = true;
    return res.json({ sucesso: true, isAdmin: true });
  }

  try {
    const result = await pool.query('SELECT id,nome,email,senha,slug,nicho,plano FROM usuarios WHERE email=$1', [email.toLowerCase().trim()]);
    if (result.rows.length === 0)
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

    const u  = result.rows[0];
    const ok = await bcrypt.compare(senha, u.senha);
    if (!ok) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

    req.session.userId    = u.id;
    req.session.userName  = u.nome;
    req.session.userSlug  = u.slug;
    req.session.userNicho = u.nicho;
    req.session.isAdmin   = false;

    res.json({ sucesso: true, slug: u.slug, nicho: u.nicho });
  } catch(e) {
    console.error('Erro login:', e.message);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  if (req.session.userId) clearMeCache(req.session.userId);
  req.session.destroy();
  res.json({ sucesso: true });
});

// GET /auth/me
router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ logado: false });
  try {
    // Usar cache para evitar query a cada carregamento de página
    let u = getMeCache(req.session.userId);
    if (!u) {
      const r = await pool.query(
        'SELECT id,nome,email,nome_negocio,nicho,plano,slug,config,trial_expira,acesso_expira,plano_pago,acesso_ativo FROM usuarios WHERE id=$1',
        [req.session.userId]
      );
      if (r.rows.length === 0) return res.status(401).json({ logado: false });
      u = r.rows[0];
      setMeCache(req.session.userId, u);
    }

    const hoje = new Date().toISOString().split('T')[0];
    let acesso_ok = true;
    let motivo_bloqueio = '';

    if (u.acesso_ativo === false) {
      acesso_ok = false; motivo_bloqueio = 'bloqueado';
    } else if (u.plano_pago) {
      if (u.acesso_expira && u.acesso_expira !== '' && u.acesso_expira < hoje) {
        acesso_ok = false; motivo_bloqueio = 'expirado';
      }
    } else {
      // Trial — só bloqueia se trial_expira existe E já passou
      if (u.trial_expira && u.trial_expira !== '' && u.trial_expira < hoje) {
        acesso_ok = false; motivo_bloqueio = 'trial_expirado';
      }
      // Se trial_expira está vazio/nulo, dá acesso (vai ser corrigido pela migration)
    }

    res.json({
      logado: true, id: u.id, nome: u.nome, email: u.email,
      nome_negocio: u.nome_negocio, nicho: u.nicho,
      plano: u.plano, slug: u.slug, config: u.config,
      acesso_ok, motivo_bloqueio,
      trial_expira: u.trial_expira, acesso_expira: u.acesso_expira, plano_pago: u.plano_pago,
    });
  } catch(e) {
    res.status(500).json({ logado: false });
  }
});

// GET /auth/email-existe?email= — validação antecipada no cadastro (passo 1)
router.get('/email-existe', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.json({ existe: false });
  try {
    const r = await pool.query('SELECT 1 FROM usuarios WHERE email=$1', [email]);
    res.json({ existe: r.rows.length > 0 });
  } catch(e) { res.json({ existe: false }); }
});

// POST /auth/recuperar — envia link de redefinição de senha
router.post('/recuperar', rateLimit({ windowMs: 10 * 60_000, max: 4, msg: 'Muitas solicitações. Aguarde alguns minutos.' }), async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  // Resposta sempre genérica — não revela se o e-mail existe
  const generica = { sucesso: true, msg: 'Se este e-mail estiver cadastrado, você receberá o link em instantes.' };
  if (!email) return res.json(generica);
  try {
    const u = (await pool.query('SELECT id, nome FROM usuarios WHERE email=$1', [email])).rows[0];
    if (u) {
      const token  = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
      const expira = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
      await pool.query('UPDATE usuarios SET reset_token=$1, reset_expira=$2 WHERE id=$3', [token, expira, u.id]);

      const link = (process.env.BASE_URL || '') + '/redefinir/' + token;
      enviarEmail({
        fromName: 'AgendaOK',
        to: email,
        subject: '🔑 Redefinir sua senha — AgendaOK',
        html: `
<div style="font-family:Arial;max-width:480px;margin:0 auto;padding:32px">
  <h2 style="color:#0d9488;margin:0 0 16px">Redefinir senha</h2>
  <p style="font-size:15px;color:#334155;line-height:1.6">Olá, <strong>${u.nome}</strong>! Recebemos um pedido para redefinir a senha da sua conta AgendaOK.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${link}" style="display:inline-block;background:#0d9488;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Criar nova senha</a>
  </p>
  <p style="font-size:13px;color:#64748b;line-height:1.6">O link vale por <strong>1 hora</strong>. Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma.</p>
  <p style="font-size:12px;color:#94a3b8;margin-top:24px">© 2026 AgendaOK</p>
</div>`,
      }).catch(e => console.error('Email recuperar:', e.message));
    }
    res.json(generica);
  } catch(e) {
    console.error('Recuperar:', e.message);
    res.json(generica);
  }
});

// POST /auth/redefinir — troca a senha usando o token do e-mail
router.post('/redefinir', rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
  const { token, senha } = req.body;
  if (!token) return res.status(400).json({ erro: 'Link inválido.' });
  if (!senha || senha.length < 6) return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });
  try {
    const u = (await pool.query(
      "SELECT id, reset_expira FROM usuarios WHERE reset_token=$1 AND reset_token != ''", [token]
    )).rows[0];
    if (!u || !u.reset_expira || new Date(u.reset_expira) < new Date()) {
      return res.status(400).json({ erro: 'Link inválido ou expirado. Solicite um novo na tela de login.' });
    }
    const hash = await bcrypt.hash(senha, 6);
    await pool.query("UPDATE usuarios SET senha=$1, reset_token='', reset_expira='' WHERE id=$2", [hash, u.id]);
    clearMeCache(u.id);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: 'Erro interno. Tente novamente.' }); }
});

module.exports = router;
module.exports.clearMeCache = clearMeCache;
