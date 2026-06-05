const express = require('express');
const router  = express.Router();
const { pool } = require('../middleware/database');

// Middleware admin master
function requireMaster(req, res, next) {
  if (req.session && req.session.isMaster) return next();
  res.status(401).json({ erro: 'Acesso restrito.' });
}

// POST /admin/login
router.post('/login', async (req, res) => {
  const { usuario, senha } = req.body;
  const MASTER_USER  = process.env.MASTER_USER;
  const MASTER_SENHA = process.env.MASTER_SENHA;
  if (!MASTER_USER || !MASTER_SENHA) {
    return res.status(503).json({ erro: 'Acesso não configurado.' });
  }
  if (usuario !== MASTER_USER || senha !== MASTER_SENHA) {
    // Delay para dificultar brute force
    await new Promise(r => setTimeout(r, 1000));
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  req.session.isMaster = true;
  res.json({ sucesso: true });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.isMaster = false;
  res.json({ sucesso: true });
});

// GET /admin/status
router.get('/status', (req, res) => {
  res.json({ logado: !!(req.session && req.session.isMaster) });
});

// GET /admin/clientes — lista todos os clientes
router.get('/clientes', requireMaster, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const r = await pool.query(`
      SELECT
        u.id, u.nome, u.email, u.nome_negocio, u.nicho,
        u.plano, u.slug,
        to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') as criado_fmt,
        u.criado_em,
        u.trial_expira, u.acesso_ativo, u.plano_pago, u.acesso_expira,
        COUNT(a.id) as total_agendamentos,
        CASE
          WHEN u.acesso_ativo = false THEN 'bloqueado'
          WHEN u.plano_pago = true AND (u.acesso_expira IS NULL OR u.acesso_expira = '' OR u.acesso_expira >= $1) THEN 'pago'
          WHEN u.trial_expira IS NOT NULL AND u.trial_expira <> '' AND u.trial_expira >= $1 AND u.acesso_ativo = true THEN 'trial'
          ELSE 'expirado'
        END as status_acesso
      FROM usuarios u
      LEFT JOIN agendamentos a ON a.negocio_id = u.id
      GROUP BY u.id
      ORDER BY u.id DESC
    `, [hoje]);
    res.json({ clientes: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /admin/clientes/:id — exclui cliente e todos os dados
router.delete('/clientes/:id', requireMaster, async (req, res) => {
  try {
    const u = (await pool.query('SELECT nome, email, nome_negocio FROM usuarios WHERE id=$1', [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    // Exclui em cascata (agendamentos, serviços, bloqueios, avaliações)
    await pool.query('DELETE FROM avaliacoes       WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM lista_espera     WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM horarios_bloqueados WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM servicos          WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM agendamentos      WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM usuarios          WHERE id=$1',         [req.params.id]);
    res.json({ sucesso: true, msg: `Conta de ${u.nome_negocio} (${u.email}) excluída.` });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /admin/clientes/:id/acesso — estende ou bloqueia acesso
router.patch('/clientes/:id/acesso', requireMaster, async (req, res) => {
  const { dias, pago, bloquear, observacao } = req.body;
  try {
    const u = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Cliente não encontrado.' });

    if (bloquear) {
      await pool.query('UPDATE usuarios SET acesso_ativo=false WHERE id=$1', [req.params.id]);
      return res.json({ sucesso: true, msg: 'Acesso bloqueado.' });
    }

    // Calcula nova data de expiração
    const hoje = new Date();
    let base = hoje;

    // Se já tem acesso_expira futuro, estende a partir dele
    if (u.acesso_expira && u.acesso_expira >= hoje.toISOString().split('T')[0]) {
      base = new Date(u.acesso_expira + 'T12:00:00');
    } else if (u.trial_expira && u.trial_expira >= hoje.toISOString().split('T')[0]) {
      base = new Date(u.trial_expira + 'T12:00:00');
    }

    base.setDate(base.getDate() + parseInt(dias || 30));
    const novaExpira = base.toISOString().split('T')[0];

    await pool.query(
      'UPDATE usuarios SET acesso_ativo=true, acesso_expira=$1, plano_pago=$2 WHERE id=$3',
      [novaExpira, pago === true, req.params.id]
    );

    res.json({ sucesso: true, msg: `Acesso liberado até ${novaExpira}.`, expira: novaExpira });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /admin/stats — estatísticas gerais
router.get('/stats', requireMaster, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const total      = +(await pool.query('SELECT COUNT(*) FROM usuarios')).rows[0].count;
    const trial      = +(await pool.query('SELECT COUNT(*) FROM usuarios WHERE trial_expira >= $1 AND plano_pago=false AND acesso_ativo=true', [hoje])).rows[0].count;
    const pagos      = +(await pool.query('SELECT COUNT(*) FROM usuarios WHERE plano_pago=true AND acesso_ativo=true')).rows[0].count;
    const expirados  = +(await pool.query('SELECT COUNT(*) FROM usuarios WHERE trial_expira < $1 AND plano_pago=false AND acesso_ativo=true', [hoje])).rows[0].count;
    const bloqueados = +(await pool.query('SELECT COUNT(*) FROM usuarios WHERE acesso_ativo=false')).rows[0].count;
    const agendamentos = +(await pool.query('SELECT COUNT(*) FROM agendamentos')).rows[0].count;
    res.json({ total, trial, pagos, expirados, bloqueados, agendamentos });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
