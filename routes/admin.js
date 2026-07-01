const express = require('express');
const router  = express.Router();
const { pool } = require('../middleware/database');
const { v4: uuidv4 } = require('uuid');

// Middleware admin master
function requireMaster(req, res, next) {
  if (req.session && req.session.isMaster) return next();
  res.status(401).json({ erro: 'Acesso restrito.' });
}

// POST /admin/login
const { rateLimit } = require('../middleware/rateLimit');
router.post('/login', rateLimit({ windowMs: 60_000, max: 5 }), (req, res) => {
  const { senha } = req.body;
  const masterSenha = process.env.MASTER_PASSWORD;
  if (!masterSenha) {
    console.error('⚠️  MASTER_PASSWORD não configurada — login master desabilitado.');
    return res.status(503).json({ erro: 'Acesso master não configurado no servidor.' });
  }
  if (senha !== masterSenha) return res.status(401).json({ erro: 'Senha incorreta.' });
  req.session.isMaster = true;
  res.json({ sucesso: true });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.isMaster = false;
  res.json({ sucesso: true });
});

// POST /admin/backup-agora — dispara o backup do banco manualmente (só master)
router.post('/backup-agora', requireMaster, async (req, res) => {
  const { rodarBackupBanco } = require('../jobs/backupBanco');
  res.json({ sucesso: true, msg: 'Backup iniciado — chega no e-mail em instantes.' });
  rodarBackupBanco().catch(e => console.error('Backup manual:', e.message));
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
        u.plano, u.slug, u.criado_em,
        u.trial_expira, u.acesso_ativo, u.plano_pago, u.acesso_expira,
        u.mp_subscription_id,
        COUNT(a.id) as total_agendamentos,
        CASE
          WHEN u.plano_pago = true AND (u.acesso_expira = '' OR u.acesso_expira >= $1) THEN 'pago'
          WHEN u.trial_expira >= $1 AND u.acesso_ativo = true THEN 'trial'
          WHEN u.acesso_ativo = false THEN 'bloqueado'
          ELSE 'expirado'
        END as status_acesso
      FROM usuarios u
      LEFT JOIN agendamentos a ON a.negocio_id = u.id
      GROUP BY u.id
      ORDER BY u.criado_em DESC
    `, [hoje]);
    res.json({ clientes: r.rows });
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

    // Cria notificação para o usuário
    const tipoPago = pago === true ? 'pagamento' : 'acesso';
    const titulo   = pago === true ? 'Pagamento confirmado!' : 'Acesso liberado!';
    const diasText = dias === 365 ? '1 ano' : `${dias} dias`;
    const msg      = pago === true
      ? `Seu pagamento foi confirmado. Acesso liberado por ${diasText} até ${novaExpira.split('-').reverse().join('/')}.`
      : `Seu acesso foi liberado por ${diasText} até ${novaExpira.split('-').reverse().join('/')}.`;

    await pool.query(
      `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [req.params.id, tipoPago, titulo, msg]
    ).catch(() => {}); // silencia erro se tabela não existir ainda

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

// POST /admin/clientes/:id/notificar — envia notificação manual
router.post('/clientes/:id/notificar', requireMaster, async (req, res) => {
  const { titulo, mensagem, tipo } = req.body;
  if (!titulo || !mensagem) return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
  try {
    const u = (await pool.query('SELECT nome, email, nome_negocio FROM usuarios WHERE id=$1', [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    await pool.query(
      `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), req.params.id, tipo || 'info', titulo.trim(), mensagem.trim()]
    );
    res.json({ sucesso: true, msg: `Notificação enviada para ${u.nome_negocio}.` });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /admin/clientes/:id — excluir cliente e todos os dados
router.delete('/clientes/:id', requireMaster, async (req, res) => {
  try {
    // Verificar se o cliente existe
    const u = (await pool.query('SELECT id, nome_negocio FROM usuarios WHERE id=$1', [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Cliente não encontrado.' });

    // Excluir todos os dados do cliente em cascata
    await pool.query('DELETE FROM agendamentos       WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM funcionarios        WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM servicos            WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM notificacoes        WHERE usuario_id=$1', [req.params.id]);
    await pool.query('DELETE FROM horarios_bloqueados WHERE negocio_id=$1', [req.params.id]);
    await pool.query('DELETE FROM usuarios            WHERE id=$1',          [req.params.id]);

    console.log(`[MASTER] Cliente excluído: ${u.nome_negocio} (${req.params.id})`);
    res.json({ sucesso: true, msg: `Cliente "${u.nome_negocio}" excluído com sucesso.` });
  } catch(e) {
    console.error('Erro ao excluir cliente:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// GET /admin/feedbacks — lista feedbacks dos usuários
router.get('/feedbacks', requireMaster, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT f.id, f.mensagem, f.lido, f.criado_em,
             u.nome, u.email, u.nome_negocio, u.slug
      FROM feedbacks f
      LEFT JOIN usuarios u ON u.id = f.usuario_id
      ORDER BY f.criado_em DESC
    `);
    res.json({ feedbacks: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /admin/feedbacks/:id/lido — marca feedback como lido
router.patch('/feedbacks/:id/lido', requireMaster, async (req, res) => {
  try {
    await pool.query('UPDATE feedbacks SET lido=true WHERE id=$1', [req.params.id]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /admin/feedbacks/:id — exclui feedback
router.delete('/feedbacks/:id', requireMaster, async (req, res) => {
  try {
    await pool.query('DELETE FROM feedbacks WHERE id=$1', [req.params.id]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
