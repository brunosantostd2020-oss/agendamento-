const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { requireAuth } = require('../middleware/auth');

// GET /servicos — listar serviços do negócio
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM servicos WHERE negocio_id=$1 AND ativo=true ORDER BY ordem ASC, criado_em ASC',
      [req.session.userId]
    );
    res.json({ servicos: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /servicos — criar serviço
router.post('/', requireAuth, async (req, res) => {
  const { nome, preco, duracao, descricao } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome do serviço obrigatório.' });
  try {
    const agora = new Date().toLocaleString('pt-BR');
    const id = uuidv4();
    await pool.query(
      'INSERT INTO servicos (id, negocio_id, nome, preco, duracao, descricao, ativo, criado_em) VALUES ($1,$2,$3,$4,$5,$6,true,$7)',
      [id, req.session.userId, nome.trim(), preco || null, duracao || 60, descricao || '', agora]
    );
    res.status(201).json({ sucesso: true, id });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /servicos/:id — editar serviço
router.patch('/:id', requireAuth, async (req, res) => {
  const { nome, preco, duracao, descricao } = req.body;
  try {
    await pool.query(
      'UPDATE servicos SET nome=$1, preco=$2, duracao=$3, descricao=$4 WHERE id=$5 AND negocio_id=$6',
      [nome, preco || null, duracao || 60, descricao || '', req.params.id, req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /servicos/:id — remover serviço
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE servicos SET ativo=false WHERE id=$1 AND negocio_id=$2',
      [req.params.id, req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /servicos/publico/:slug — serviços públicos de um negócio
router.get('/publico/:slug', async (req, res) => {
  try {
    const u = await pool.query('SELECT id FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (!u.rows.length) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const r = await pool.query(
      'SELECT id, nome, preco, duracao, descricao FROM servicos WHERE negocio_id=$1 AND ativo=true ORDER BY ordem ASC, criado_em ASC',
      [u.rows[0].id]
    );
    res.json({ servicos: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
