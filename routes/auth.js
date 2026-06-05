const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { lerDb, salvarDb } = require('../middleware/database');

// POST /auth/cadastro
router.post('/cadastro', async (req, res) => {
  const { nome, email, senha, nome_negocio, nicho, plano } = req.body;

  if (!nome || !email || !senha || !nome_negocio || !nicho || !plano)
    return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erro: 'E-mail inválido.' });

  if (senha.length < 6)
    return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });

  const db = lerDb();
  if (db.usuarios.find(u => u.email === email.toLowerCase()))
    return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });

  // Gera slug único para a página pública
  const slugBase = nome_negocio.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let slug = slugBase;
  let i = 1;
  while (db.usuarios.find(u => u.slug === slug)) { slug = slugBase + '-' + i; i++; }

  const hash = await bcrypt.hash(senha, 10);
  const agora = new Date().toLocaleString('pt-BR');

  const usuario = {
    id: uuidv4(),
    nome: nome.trim(),
    email: email.toLowerCase().trim(),
    senha: hash,
    nome_negocio: nome_negocio.trim(),
    nicho,
    plano,
    slug,
    ativo: true,
    criado_em: agora,
    // Configurações padrão do negócio
    config: {
      horarios: '08:00,09:00,10:00,11:00,14:00,15:00,16:00,17:00',
      dias_uteis: '1,2,3,4,5',
      telefone: '',
      descricao: '',
      cor: '#0d9488',
    }
  };

  db.usuarios.push(usuario);
  salvarDb(db);

  req.session.userId    = usuario.id;
  req.session.userName  = usuario.nome;
  req.session.userSlug  = usuario.slug;
  req.session.userNicho = usuario.nicho;
  req.session.isAdmin   = false;

  res.status(201).json({ sucesso: true, slug: usuario.slug, nicho: usuario.nicho });
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

  const db = lerDb();
  const usuario = db.usuarios.find(u => u.email === email.toLowerCase().trim());
  if (!usuario) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

  const ok = await bcrypt.compare(senha, usuario.senha);
  if (!ok) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });

  req.session.userId    = usuario.id;
  req.session.userName  = usuario.nome;
  req.session.userSlug  = usuario.slug;
  req.session.userNicho = usuario.nicho;
  req.session.isAdmin   = false;

  res.json({ sucesso: true, slug: usuario.slug, nicho: usuario.nicho });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ sucesso: true });
});

// GET /auth/me
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ logado: false });
  const db = lerDb();
  const u  = db.usuarios.find(u => u.id === req.session.userId);
  if (!u) return res.status(401).json({ logado: false });
  res.json({
    logado: true,
    id: u.id, nome: u.nome, email: u.email,
    nome_negocio: u.nome_negocio, nicho: u.nicho,
    plano: u.plano, slug: u.slug, config: u.config,
  });
});

module.exports = router;
