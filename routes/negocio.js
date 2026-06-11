const express = require('express');

// Data de hoje no fuso de Brasília (UTC-3)
function hojeBC() {
  const agora = new Date();
  const br = new Date(agora.getTime() - 3*60*60*1000);
  return br.toISOString().split('T')[0];
}
const hojeFunc = hojeBC;
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

    const hoje     = hojeFunc();
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
    if (status && status !== 'todos') { sql += ' AND status=$2'; params.push(status); }
    // Limitar a 500 por performance se não houver filtro
    sql += ' ORDER BY data DESC, horario ASC LIMIT 500';
    const r = await pool.query(sql, params);
    res.json({ agendamentos: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /negocio/agendamentos/hoje
router.get('/agendamentos/hoje', requireAuth, async (req, res) => {
  try {
    const hoje = hojeFunc();
    const r = await pool.query(
      'SELECT * FROM agendamentos WHERE negocio_id=$1 AND data=$2 ORDER BY horario ASC',
      [req.session.userId, hoje]
    );
    res.json({ agendamentos: r.rows, data: hoje });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /negocio/clientes — lista de clientes com histórico de visitas
router.get('/clientes', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // data é TEXT (YYYY-MM-DD) — usar comparação textual que funciona nesse formato
    const { rows } = await pool.query(`
      SELECT
        nome,
        telefone,
        email,
        COUNT(*)::int                                     AS total_agendamentos,
        COUNT(*) FILTER (WHERE status = 'concluido')::int AS visitas_concluidas,
        COUNT(*) FILTER (
          WHERE status = 'cancelado'
            AND data < TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
        )::int AS cancelamentos,
        COUNT(*) FILTER (
          WHERE status IN ('pendente','confirmado')
            AND data < TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
        )::int AS nao_apareceu,
        MAX(data) AS ultima_visita,
        COALESCE(SUM(
          CASE WHEN status = 'concluido' AND preco_servico IS NOT NULL
               THEN preco_servico ELSE 0 END
        ), 0) AS total_gasto,
        CASE WHEN MAX(data) IS NOT NULL THEN (CURRENT_DATE - TO_DATE(MAX(data), 'YYYY-MM-DD'))::int ELSE NULL END AS dias_ausente
      FROM agendamentos
      WHERE negocio_id = $1
        AND nome IS NOT NULL
        AND TRIM(nome) != ''
      GROUP BY nome, telefone, email
      ORDER BY MAX(data) DESC NULLS LAST
    `, [userId]);

    res.json({ clientes: rows });
  } catch(e) {
    console.error('Erro /clientes:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// POST /negocio/agendamentos/manual — agendamento manual pelo dono (sem exigir telefone)
router.post('/agendamentos/manual', requireAuth, async (req, res) => {
  const { nome, telefone, data, horario, servico, preco_servico, obs } = req.body;
  if (!nome || !data || !horario)
    return res.status(400).json({ erro: 'Nome, data e horário são obrigatórios.' });
  try {
    const uid = req.session.userId;
    const u   = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [uid])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const { v4: uuidv4 } = require('uuid');
    const agId   = uuidv4();
    const tokenC = uuidv4().replace(/-/g,'');
    const tokenA = uuidv4().replace(/-/g,'');
    const tokenCF= uuidv4().replace(/-/g,'');
    const agora  = new Date().toLocaleString('pt-BR');

    await pool.query(
      `INSERT INTO agendamentos
        (id,negocio_id,negocio_slug,nome,email,telefone,servico,preco_servico,obs,
         data,horario,status,token_cancel,token_avalia,token_confirm,criado_em,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmado',$12,$13,$14,$15,$15)`,
      [agId, uid, u.slug, nome.trim(), '', telefone||'',
       servico||'', preco_servico ? parseFloat(preco_servico) : null,
       obs||'', data, horario, tokenC, tokenA, tokenCF, agora]
    );

    res.json({ sucesso: true, id: agId });
  } catch(e) {
    console.error('Erro agendamento manual:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// PATCH /negocio/agendamentos/:id/status
router.patch('/agendamentos/:id/status', requireAuth, async (req, res) => {
  const { status, obs, servico_concluido, preco_concluido, funcionario_id } = req.body;
  const statusValidos = ['pendente','confirmado','cancelado','concluido','reagendado'];
  if (!statusValidos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  try {
    const agora = new Date().toLocaleString('pt-BR');
    // Se concluído, atualiza também servico e preco_servico
    if (status === 'concluido' && servico_concluido) {
      await pool.query(
        `UPDATE agendamentos SET status=$1, obs=$2, atualizado_em=$3,
         servico=$4, preco_servico=$5
         WHERE id=$6 AND negocio_id=$7`,
        [status, obs||'', agora, servico_concluido,
         preco_concluido ? parseFloat(preco_concluido) : null,
         req.params.id, req.session.userId]
      );
    } else {
      await pool.query(
        'UPDATE agendamentos SET status=$1, obs=$2, atualizado_em=$3 WHERE id=$4 AND negocio_id=$5',
        [status, obs||'', agora, req.params.id, req.session.userId]
      );
    }
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

// GET /negocio/buscar?q=termo — busca global
router.get('/buscar', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ agendamentos: [], clientes: [] });
  try {
    const like = `%${q}%`;
    const uid  = req.session.userId;

    // Buscar agendamentos recentes que coincidem
    const ags = await pool.query(`
      SELECT id, nome, telefone, servico, data, horario, status
      FROM agendamentos
      WHERE negocio_id = $1
        AND (LOWER(nome) LIKE LOWER($2) OR LOWER(servico) LIKE LOWER($2) OR telefone LIKE $2)
      ORDER BY data DESC LIMIT 6
    `, [uid, like]);

    // Buscar clientes únicos
    const clis = await pool.query(`
      SELECT DISTINCT nome, telefone,
        COUNT(*) AS visitas,
        MAX(data) AS ultima
      FROM agendamentos
      WHERE negocio_id = $1
        AND (LOWER(nome) LIKE LOWER($2) OR telefone LIKE $2)
      GROUP BY nome, telefone
      ORDER BY MAX(data) DESC LIMIT 4
    `, [uid, like]);

    res.json({ agendamentos: ags.rows, clientes: clis.rows });
  } catch(e) {
    res.json({ agendamentos: [], clientes: [] });
  }
});

// GET /negocio/clientes/:telefone/historico — histórico completo
router.get('/clientes/:telefone/historico', requireAuth, async (req, res) => {
  try {
    const tel = decodeURIComponent(req.params.telefone);
    const r = await pool.query(`
      SELECT id, nome, data, horario, servico, status, preco_servico, obs
      FROM agendamentos
      WHERE negocio_id = $1 AND telefone = $2
      ORDER BY data DESC, horario DESC
      LIMIT 50
    `, [req.session.userId, tel]);
    res.json({ historico: r.rows });
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
    // Limpar cache do /auth/me para refletir novas configs
    try {
      const authRouter = require('./auth');
      if (authRouter.clearMeCache) authRouter.clearMeCache(req.session.userId);
    } catch(e) {}
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
