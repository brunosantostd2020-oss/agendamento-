const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { lerDb, salvarDb } = require('../middleware/database');
const { enviarConfirmacao } = require('../middleware/email');

// GET /p/:slug/info
router.get('/:slug/info', (req, res) => {
  const db = lerDb();
  const u  = db.usuarios.find(u => u.slug === req.params.slug && u.ativo);
  if (!u) return res.status(404).json({ erro: 'Negócio não encontrado.' });
  res.json({
    nome_negocio: u.nome_negocio,
    nicho: u.nicho,
    config: {
      horarios:    u.config.horarios,
      dias_uteis:  u.config.dias_uteis,
      telefone:    u.config.telefone,
      descricao:   u.config.descricao,
      cor:         u.config.cor,
    }
  });
});

// GET /p/:slug/horarios?data=YYYY-MM-DD
router.get('/:slug/horarios', (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).json({ erro: 'Data obrigatória.' });

  const db = lerDb();
  const u  = db.usuarios.find(u => u.slug === req.params.slug && u.ativo);
  if (!u) return res.status(404).json({ erro: 'Negócio não encontrado.' });

  const diasUteis = u.config.dias_uteis.split(',').map(Number);
  const diaSemana = new Date(data + 'T12:00:00').getDay();
  if (!diasUteis.includes(diaSemana))
    return res.json({ horarios: [], mensagem: 'Dia não disponível.' });

  const hoje = new Date().toISOString().split('T')[0];
  if (data < hoje) return res.json({ horarios: [], mensagem: 'Data no passado.' });

  const todos = u.config.horarios.split(',');

  const ocupados = db.agendamentos
    .filter(a => a.negocio_id === u.id && a.data === data && ['pendente','confirmado'].includes(a.status))
    .map(a => a.horario);

  const bloqueados = db.horarios_bloqueados
    .filter(b => b.negocio_id === u.id && b.data === data)
    .map(b => b.horario);

  const indisponiveis = new Set([...ocupados, ...bloqueados]);
  const horarios = todos.map(h => ({ horario: h, disponivel: !indisponiveis.has(h) }));

  res.json({ horarios });
});

// POST /p/:slug/agendar
router.post('/:slug/agendar', async (req, res) => {
  const { nome, email, telefone, servico, data, horario, obs } = req.body;

  if (!nome || !email || !telefone || !data || !horario)
    return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });

  const db = lerDb();
  const u  = db.usuarios.find(u => u.slug === req.params.slug && u.ativo);
  if (!u) return res.status(404).json({ erro: 'Negócio não encontrado.' });

  const existente = db.agendamentos.find(
    a => a.negocio_id === u.id && a.data === data && a.horario === horario
       && ['pendente','confirmado'].includes(a.status)
  );
  if (existente) return res.status(409).json({ erro: 'Horário já reservado. Escolha outro.' });

  const id = uuidv4();
  const agora = new Date().toLocaleString('pt-BR');

  db.agendamentos.push({
    id,
    negocio_id:   u.id,
    negocio_slug: u.slug,
    nome:     nome.trim(),
    email:    email.trim().toLowerCase(),
    telefone: telefone.trim(),
    servico:  servico || '',
    obs:      obs || '',
    data,
    horario,
    status:       'pendente',
    criado_em:    agora,
    atualizado_em:agora,
  });

  salvarDb(db);

  // Envia e-mail de confirmação (não bloqueia a resposta)
  enviarConfirmacao({
    nomeCliente:  nome.trim(),
    emailCliente: email.trim().toLowerCase(),
    nomeNegocio:  u.nome_negocio,
    nicho:        u.nicho,
    data,
    horario,
    servico:      servico || '',
    corNegocio:   u.config.cor || '#0d9488',
  }).catch(e => console.error('Erro email:', e.message));

  res.status(201).json({ sucesso: true, mensagem: 'Agendamento realizado com sucesso!' });
});

module.exports = router;
