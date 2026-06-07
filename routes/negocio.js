const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// GET /negocio/painel
router.get('/painel', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.session.userId])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const hoje     = new Date().toISOString().split('T')[0];
    const mesAtual = hoje.slice(0, 7);

    const total      = +(await pool.query('SELECT COUNT(*) FROM agendamentos WHERE negocio_id=$1', [u.id])).rows[0].count;
    const pendentes  = +(await pool.query(`SELECT COUNT(*) FROM agendamentos WHERE negocio_id=$1 AND status='pendente'`, [u.id])).rows[0].count;
    const confirmados= +(await pool.query(`SELECT COUNT(*) FROM agendamentos WHERE negocio_id=$1 AND status='confirmado'`, [u.id])).rows[0].count;
    const concluidos = +(await pool.query(`SELECT COUNT(*) FROM agendamentos WHERE negocio_id=$1 AND status='concluido'`, [u.id])).rows[0].count;
    const hojeCount  = +(await pool.query('SELECT COUNT(*) FROM agendamentos WHERE negocio_id=$1 AND data=$2', [u.id, hoje])).rows[0].count;

    // Faturamento do mês (apenas concluídos com preço)
    const fatR = await pool.query(
      `SELECT COALESCE(SUM(preco_servico),0) as total FROM agendamentos WHERE negocio_id=$1 AND status='concluido' AND data LIKE $2 AND preco_servico IS NOT NULL`,
      [u.id, mesAtual + '%']
    );
    const faturamento = parseFloat(fatR.rows[0].total) || null;

    res.json({ usuario: u, stats: { total, pendentes, confirmados, concluidos, hoje: hojeCount, faturamento } });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /negocio/agendamentos
router.get('/agendamentos', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM agendamentos WHERE negocio_id=$1';
    const params = [req.session.userId];
    if (status) { sql += ' AND status=$2'; params.push(status); }
    sql += ' ORDER BY data ASC, horario ASC';
    const r = await pool.query(sql, params);
    res.json({ agendamentos: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /negocio/agendamentos/hoje
router.get('/agendamentos/hoje', requireAuth, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      'SELECT * FROM agendamentos WHERE negocio_id=$1 AND data=$2 ORDER BY horario ASC',
      [req.session.userId, hoje]
    );
    res.json({ agendamentos: r.rows, data: hoje });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /negocio/agendamentos/:id/status
router.patch('/agendamentos/:id/status', requireAuth, async (req, res) => {
  const { status, obs } = req.body;
  const statusValidos = ['pendente','confirmado','cancelado','concluido'];
  if (!statusValidos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  try {
    const agora = new Date().toLocaleString('pt-BR');
    await pool.query(
      'UPDATE agendamentos SET status=$1, obs=$2, atualizado_em=$3 WHERE id=$4 AND negocio_id=$5',
      [status, obs||'', agora, req.params.id, req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /negocio/agendamentos/:id
router.delete('/agendamentos/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM agendamentos WHERE id=$1 AND negocio_id=$2', [req.params.id, req.session.userId]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /negocio/config
router.get('/config', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT config FROM usuarios WHERE id=$1', [req.session.userId]);
    res.json(r.rows[0]?.config || {});
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /negocio/config
router.patch('/config', requireAuth, async (req, res) => {
  try {
    const r   = await pool.query('SELECT config, nome_negocio FROM usuarios WHERE id=$1', [req.session.userId]);
    const u   = r.rows[0];
    const cfg = { ...u.config };

    const campos = ['horarios','dias_uteis','telefone','descricao','cor','email_negocio','email_senha'];
    campos.forEach(c => { if (req.body[c] !== undefined) cfg[c] = req.body[c]; });

    const nomeNegocio = req.body.nome_negocio || u.nome_negocio;
    await pool.query('UPDATE usuarios SET config=$1, nome_negocio=$2 WHERE id=$3', [JSON.stringify(cfg), nomeNegocio, req.session.userId]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /negocio/testar-email
router.post('/testar-email', requireAuth, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });
  try {
    const u = (await pool.query('SELECT nome_negocio FROM usuarios WHERE id=$1', [req.session.userId])).rows[0];
    const t = nodemailer.createTransport({ service:'gmail', auth:{ user:email, pass:senha } });
    await t.sendMail({
      from: `"${u.nome_negocio} via AgendaOK" <${email}>`,
      to: email,
      subject: ' Teste de e-mail — AgendaOK',
      html: `<div style="font-family:Arial;padding:32px;background:#f0fdf4;border-radius:12px;border:2px solid #bbf7d0;max-width:500px;margin:0 auto">
        <h2 style="color:#15803d"> E-mail configurado com sucesso!</h2>
        <p style="color:#334155">Seus clientes receberão as confirmações de agendamento por este endereço.</p>
        <p style="color:#64748b;font-size:13px">— AgendaOK</p>
      </div>`,
    });
    res.json({ sucesso: true });
  } catch(e) { res.status(400).json({ sucesso: false, erro: e.message }); }
});

// POST /negocio/bloquear
router.post('/bloquear', requireAuth, async (req, res) => {
  const { data, horario, motivo } = req.body;
  if (!data || !horario) return res.status(400).json({ erro: 'Data e horário obrigatórios.' });
  try {
    const u   = (await pool.query('SELECT config FROM usuarios WHERE id=$1', [req.session.userId])).rows[0];
    const hrs = horario === 'todos' ? (u.config.horarios || '').split(',') : [horario];
    const agora = new Date().toLocaleString('pt-BR');
    for (const h of hrs) {
      await pool.query(
        'INSERT INTO horarios_bloqueados (id, negocio_id, data, horario, motivo, criado_em) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuidv4(), req.session.userId, data, h, motivo||'', agora]
      );
    }
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /negocio/bloqueados
router.get('/bloqueados', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM horarios_bloqueados WHERE negocio_id=$1 ORDER BY data ASC, horario ASC',
      [req.session.userId]
    );
    res.json({ bloqueados: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /negocio/bloqueados/:id
router.delete('/bloqueados/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM horarios_bloqueados WHERE id=$1 AND negocio_id=$2', [req.params.id, req.session.userId]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;

// ── NOTIFICAÇÕES ──────────────────────────────────────────────

// GET /negocio/notificacoes
router.get('/notificacoes', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM notificacoes WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 30',
      [req.session.userId]
    );
    const naoLidas = r.rows.filter(n => !n.lida).length;
    res.json({ notificacoes: r.rows, nao_lidas: naoLidas });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /negocio/notificacoes/lidas — marca todas como lidas
router.patch('/notificacoes/lidas', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notificacoes SET lida=true WHERE usuario_id=$1',
      [req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// PATCH /negocio/notificacoes/:id/lida — marca uma como lida
router.patch('/notificacoes/:id/lida', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notificacoes SET lida=true WHERE id=$1 AND usuario_id=$2',
      [req.params.id, req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /negocio/notificacoes — limpa todas
router.delete('/notificacoes', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM notificacoes WHERE usuario_id=$1', [req.session.userId]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});
