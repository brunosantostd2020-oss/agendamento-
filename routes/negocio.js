const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { lerDb, salvarDb } = require('../middleware/database');
const { requireAuth } = require('../middleware/auth');

// GET /negocio/painel - dados do painel
router.get('/painel', requireAuth, (req, res) => {
  const db = lerDb();
  const u  = db.usuarios.find(u => u.id === req.session.userId);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const hoje = new Date().toISOString().split('T')[0];
  const mesAtual = hoje.slice(0, 7);

  const meus = db.agendamentos.filter(a => a.negocio_id === u.id);
  const total      = meus.length;
  const pendentes  = meus.filter(a => a.status === 'pendente').length;
  const confirmados= meus.filter(a => a.status === 'confirmado').length;
  const hojeCount  = meus.filter(a => a.data === hoje).length;
  const mesCount   = meus.filter(a => a.data.startsWith(mesAtual)).length;

  res.json({ usuario: u, stats: { total, pendentes, confirmados, hoje: hojeCount, mes: mesCount } });
});

// GET /negocio/agendamentos
router.get('/agendamentos', requireAuth, (req, res) => {
  const { status } = req.query;
  const db = lerDb();
  let lista = db.agendamentos.filter(a => a.negocio_id === req.session.userId);
  if (status) lista = lista.filter(a => a.status === status);
  lista.sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  res.json({ agendamentos: lista });
});

// GET /negocio/agendamentos/hoje
router.get('/agendamentos/hoje', requireAuth, (req, res) => {
  const db   = lerDb();
  const hoje = new Date().toISOString().split('T')[0];
  const lista = db.agendamentos
    .filter(a => a.negocio_id === req.session.userId && a.data === hoje)
    .sort((a, b) => a.horario.localeCompare(b.horario));
  res.json({ agendamentos: lista, data: hoje });
});

// PATCH /negocio/agendamentos/:id/status
router.patch('/agendamentos/:id/status', requireAuth, (req, res) => {
  const { status, obs } = req.body;
  const statusValidos = ['pendente','confirmado','cancelado','concluido'];
  if (!statusValidos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });

  const db  = lerDb();
  const idx = db.agendamentos.findIndex(a => a.id === req.params.id && a.negocio_id === req.session.userId);
  if (idx === -1) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

  db.agendamentos[idx].status = status;
  db.agendamentos[idx].obs    = obs || '';
  db.agendamentos[idx].atualizado_em = new Date().toLocaleString('pt-BR');
  salvarDb(db);
  res.json({ sucesso: true });
});

// DELETE /negocio/agendamentos/:id
router.delete('/agendamentos/:id', requireAuth, (req, res) => {
  const db = lerDb();
  db.agendamentos = db.agendamentos.filter(
    a => !(a.id === req.params.id && a.negocio_id === req.session.userId)
  );
  salvarDb(db);
  res.json({ sucesso: true });
});

// GET /negocio/config
router.get('/config', requireAuth, (req, res) => {
  const db = lerDb();
  const u  = db.usuarios.find(u => u.id === req.session.userId);
  res.json(u.config);
});

// PATCH /negocio/config
router.patch('/config', requireAuth, (req, res) => {
  const db  = lerDb();
  const idx = db.usuarios.findIndex(u => u.id === req.session.userId);
  if (idx === -1) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const campos = ['horarios','dias_uteis','telefone','descricao','cor','email_negocio','email_senha'];
  campos.forEach(c => {
    if (req.body[c] !== undefined) db.usuarios[idx].config[c] = req.body[c];
  });
  if (req.body['nome_negocio']) db.usuarios[idx].nome_negocio = req.body['nome_negocio'];
  salvarDb(db);
  res.json({ sucesso: true });
});

// POST /negocio/testar-email
router.post('/testar-email', requireAuth, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });

  const db = lerDb();
  const u  = db.usuarios.find(u => u.id === req.session.userId);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: email, pass: senha },
    });
    await t.sendMail({
      from: `"${u.nome_negocio} via AgendaOK" <${email}>`,
      to: email,
      subject: '✅ Teste de e-mail — AgendaOK',
      html: `<div style="font-family:Arial;padding:32px;max-width:500px;margin:0 auto;background:#f0fdf4;border-radius:12px;border:2px solid #bbf7d0">
        <h2 style="color:#15803d">✅ E-mail configurado com sucesso!</h2>
        <p style="color:#334155">Seu e-mail está funcionando corretamente. Seus clientes receberão as confirmações de agendamento por este endereço.</p>
        <p style="color:#64748b;font-size:13px">— AgendaOK</p>
      </div>`,
    });
    res.json({ sucesso: true });
  } catch(e) {
    res.status(400).json({ sucesso: false, erro: e.message });
  }
});

// POST /negocio/bloquear
router.post('/bloquear', requireAuth, (req, res) => {
  const { data, horario, motivo } = req.body;
  if (!data || !horario) return res.status(400).json({ erro: 'Data e horário obrigatórios.' });
  const db = lerDb();
  const horarios = horario === 'todos'
    ? (db.usuarios.find(u => u.id === req.session.userId)?.config?.horarios || '').split(',')
    : [horario];
  horarios.forEach(h => {
    db.horarios_bloqueados.push({
      id: uuidv4(), negocio_id: req.session.userId,
      data, horario: h, motivo: motivo || '',
      criado_em: new Date().toLocaleString('pt-BR'),
    });
  });
  salvarDb(db);
  res.json({ sucesso: true });
});

// GET /negocio/bloqueados
router.get('/bloqueados', requireAuth, (req, res) => {
  const db = lerDb();
  const lista = db.horarios_bloqueados
    .filter(b => b.negocio_id === req.session.userId)
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  res.json({ bloqueados: lista });
});

// DELETE /negocio/bloqueados/:id
router.delete('/bloqueados/:id', requireAuth, (req, res) => {
  const db = lerDb();
  db.horarios_bloqueados = db.horarios_bloqueados.filter(
    b => !(b.id === req.params.id && b.negocio_id === req.session.userId)
  );
  salvarDb(db);
  res.json({ sucesso: true });
});

module.exports = router;
