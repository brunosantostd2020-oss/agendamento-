const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { enviarConfirmacao } = require('../middleware/email');

// GET /p/:slug/info
router.get('/:slug/info', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (r.rows.length === 0) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const u = r.rows[0];
    res.json({
      nome_negocio: u.nome_negocio, nicho: u.nicho,
      config: {
        horarios:   u.config.horarios,
        dias_uteis: u.config.dias_uteis,
        telefone:   u.config.telefone,
        descricao:  u.config.descricao,
        cor:        u.config.cor,
      }
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /p/:slug/horarios?data=YYYY-MM-DD
router.get('/:slug/horarios', async (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).json({ erro: 'Data obrigatória.' });
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (r.rows.length === 0) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const u = r.rows[0];

    const diasUteis = (u.config.dias_uteis || '1,2,3,4,5').split(',').map(Number);
    const diaSemana = new Date(data + 'T12:00:00').getDay();
    if (!diasUteis.includes(diaSemana))
      return res.json({ horarios: [], mensagem: 'Dia não disponível.' });

    const hoje = new Date().toISOString().split('T')[0];
    if (data < hoje) return res.json({ horarios: [], mensagem: 'Data no passado.' });

    const todos = (u.config.horarios || '').split(',');

    const ocupados = (await pool.query(
      `SELECT horario FROM agendamentos WHERE negocio_id=$1 AND data=$2 AND status IN ('pendente','confirmado')`,
      [u.id, data]
    )).rows.map(r => r.horario);

    const bloqueados = (await pool.query(
      'SELECT horario FROM horarios_bloqueados WHERE negocio_id=$1 AND data=$2',
      [u.id, data]
    )).rows.map(r => r.horario);

    const indisponiveis = new Set([...ocupados, ...bloqueados]);
    const horarios = todos.map(h => ({ horario: h, disponivel: !indisponiveis.has(h) }));
    res.json({ horarios });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /p/:slug/agendar
router.post('/:slug/agendar', async (req, res) => {
  const { nome, email, telefone, servico, data, horario, obs } = req.body;
  if (!nome || !email || !telefone || !data || !horario)
    return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });

  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (r.rows.length === 0) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const u = r.rows[0];

    const existente = await pool.query(
      `SELECT id FROM agendamentos WHERE negocio_id=$1 AND data=$2 AND horario=$3 AND status IN ('pendente','confirmado')`,
      [u.id, data, horario]
    );
    if (existente.rows.length > 0)
      return res.status(409).json({ erro: 'Horário já reservado. Escolha outro.' });

    const agora = new Date().toLocaleString('pt-BR');
    await pool.query(
      `INSERT INTO agendamentos (id,negocio_id,negocio_slug,nome,email,telefone,servico,obs,data,horario,status,criado_em,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente',$11,$11)`,
      [uuidv4(), u.id, u.slug, nome.trim(), email.trim().toLowerCase(), telefone.trim(), servico||'', obs||'', data, horario, agora]
    );

    // E-mail de confirmação
    enviarConfirmacao({
      nomeCliente: nome.trim(), emailCliente: email.trim().toLowerCase(),
      nomeNegocio: u.nome_negocio, nicho: u.nicho, data, horario,
      servico: servico||'', corNegocio: u.config.cor||'#0d9488',
      emailNegocio: u.config.email_negocio||'', senhaEmailNegocio: u.config.email_senha||'',
    }).catch(e => console.error('Erro email:', e.message));

    res.status(201).json({ sucesso: true, mensagem: 'Agendamento realizado com sucesso!' });
  } catch(e) {
    console.error('Erro agendar:', e.message);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
});

module.exports = router;
