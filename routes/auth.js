const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { enviarBoasVindas, enviarInstrucoesPagamento } = require('../middleware/email');

// POST /auth/cadastro
router.post('/cadastro', async (req, res) => {
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

    const hash  = await bcrypt.hash(senha, 10);
    const agora = new Date().toLocaleString('pt-BR');
    const id    = uuidv4();
    const config = {
      horarios: '08:00,09:00,10:00,11:00,14:00,15:00,16:00,17:00',
      dias_uteis: '1,2,3,4,5',
      telefone: '', descricao: '', cor: '#0d9488',
      email_negocio: '', email_senha: '',
    };

    await pool.query(
      `INSERT INTO usuarios (id, nome, email, senha, nome_negocio, nicho, plano, slug, ativo, criado_em, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)`,
      [id, nome.trim(), email.toLowerCase().trim(), hash, nome_negocio.trim(), nicho, plano, slug, agora, JSON.stringify(config)]
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
router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });

  // Admin master
  if (email === (process.env.ADMIN_EMAIL || 'admin@agendaok.com') &&
      senha  === (process.env.ADMIN_PASSWORD || 'admin123')) {
    req.session.userId  = 'admin';
    req.session.isAdmin = true;
    return res.json({ sucesso: true, isAdmin: true });
  }

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email.toLowerCase().trim()]);
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
  req.session.destroy();
  res.json({ sucesso: true });
});

// GET /auth/me
router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ logado: false });
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.session.userId]);
    if (r.rows.length === 0) return res.status(401).json({ logado: false });
    const u = r.rows[0];

    const hoje = new Date().toISOString().split('T')[0];
    let acesso_ok = true;
    let motivo_bloqueio = '';

    if (!u.acesso_ativo) {
      acesso_ok = false; motivo_bloqueio = 'bloqueado';
    } else if (u.plano_pago) {
      if (u.acesso_expira && u.acesso_expira < hoje) { acesso_ok = false; motivo_bloqueio = 'expirado'; }
    } else {
      if (!u.trial_expira || u.trial_expira < hoje) { acesso_ok = false; motivo_bloqueio = 'trial_expirado'; }
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

module.exports = router;
