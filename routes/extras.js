const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { requireAuth } = require('../middleware/auth');
const { enviarEmail } = require('../middleware/mailer');

// ── CONFIRMAÇÃO PELO DONO ─────────────────────────────────────

// GET /extras/confirmar/:token
router.get('/confirmar/:token', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, u.nome_negocio, u.config FROM agendamentos a
       JOIN usuarios u ON a.negocio_id = u.id
       WHERE a.token_confirm = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido ou expirado.' });
    const a = r.rows[0];
    res.json({
      id: a.id, nome: a.nome, telefone: a.telefone,
      data: a.data, horario: a.horario,
      servico: a.servico || '', preco: a.preco_servico,
      status: a.status, negocio: a.nome_negocio,
      cor: a.config?.cor || '#0a0a0a',
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /extras/confirmar/:token
router.post('/confirmar/:token', async (req, res) => {
  const { acao } = req.body; // 'confirmado' ou 'cancelado'
  const statusValidos = ['confirmado', 'cancelado'];
  if (!statusValidos.includes(acao)) return res.status(400).json({ erro: 'Ação inválida.' });
  try {
    const r = await pool.query(
      'SELECT * FROM agendamentos WHERE token_confirm = $1', [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido.' });
    const a = r.rows[0];
    if (a.status !== 'pendente') {
      return res.json({ sucesso: true, ja_processado: true, status: a.status });
    }
    await pool.query(
      `UPDATE agendamentos SET status=$1, atualizado_em=$2 WHERE token_confirm=$3`,
      [acao, new Date().toLocaleString('pt-BR'), req.params.token]
    );

    // ── Notificação no sino do painel do dono ──
    const [ano, mes, dia] = (a.data || '').split('-');
    const dataFmt = a.data ? `${dia}/${mes}/${ano}` : '';
    const horFmt  = a.horario || '';
    const nomeCliente = a.nome || 'Cliente';

    let titulo, mensagem;
    if (acao === 'confirmado') {
      titulo   = `✅ ${nomeCliente} confirmou!`;
      mensagem = `O agendamento de ${nomeCliente} para ${dataFmt} às ${horFmt}${a.servico ? ' ('+a.servico+')' : ''} foi confirmado pelo cliente.`;
    } else {
      titulo   = `❌ ${nomeCliente} cancelou`;
      mensagem = `O agendamento de ${nomeCliente} para ${dataFmt} às ${horFmt} foi cancelado pelo cliente.`;
    }

    // Salva notificação (silencia erro para não quebrar o fluxo)
    pool.query(
      `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [a.negocio_id, acao === 'confirmado' ? 'pagamento' : 'aviso', titulo, mensagem]
    ).catch(e => console.error('Notif confirm:', e.message));

    res.json({ sucesso: true, status: acao });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── CANCELAMENTO ─────────────────────────────────────────────

// GET /extras/cancelar/:token — verifica token
router.get('/cancelar/:token', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, u.nome_negocio FROM agendamentos a
       JOIN usuarios u ON a.negocio_id = u.id
       WHERE a.token_cancel = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido ou expirado.' });
    const a = r.rows[0];
    if (a.status === 'cancelado') return res.json({ ja_cancelado: true, negocio: a.nome_negocio });
    res.json({
      nome: a.nome, data: a.data, horario: a.horario,
      servico: a.servico || '', negocio: a.nome_negocio, status: a.status,
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /extras/cancelar/:token — executa cancelamento
router.post('/cancelar/:token', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM agendamentos WHERE token_cancel = $1', [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido.' });
    const a = r.rows[0];
    if (a.status === 'cancelado') return res.json({ sucesso: true, ja_cancelado: true });

    await pool.query(
      `UPDATE agendamentos SET status='cancelado', atualizado_em=$1 WHERE token_cancel=$2`,
      [new Date().toLocaleString('pt-BR'), req.params.token]
    );

    // Notifica lista de espera
    await notificarListaEspera(a.negocio_id, a.data, a.horario);

    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── AVALIAÇÃO ─────────────────────────────────────────────────

// GET /extras/avaliar/:token
router.get('/avaliar/:token', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, u.nome_negocio FROM agendamentos a
       JOIN usuarios u ON a.negocio_id = u.id
       WHERE a.token_avalia = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido.' });
    const a = r.rows[0];
    if (a.avaliado) return res.json({ ja_avaliado: true, negocio: a.nome_negocio });
    res.json({ nome: a.nome, negocio: a.nome_negocio, servico: a.servico || '', data: a.data });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /extras/avaliar/:token
router.post('/avaliar/:token', async (req, res) => {
  const { nota, comentario } = req.body;
  if (!nota || nota < 1 || nota > 5) return res.status(400).json({ erro: 'Nota inválida (1-5).' });
  try {
    const r = await pool.query(
      'SELECT * FROM agendamentos WHERE token_avalia = $1', [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido.' });
    const a = r.rows[0];
    if (a.avaliado) return res.status(409).json({ erro: 'Já avaliado.' });

    await pool.query(
      'INSERT INTO avaliacoes (id, negocio_id, agendamento_id, nome_cliente, nota, comentario, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [uuidv4(), a.negocio_id, a.id, a.nome, nota, comentario || '', new Date().toLocaleString('pt-BR')]
    );
    await pool.query('UPDATE agendamentos SET avaliado=true WHERE id=$1', [a.id]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /extras/avaliacoes — painel do dono
router.get('/avaliacoes', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM avaliacoes WHERE negocio_id=$1 ORDER BY criado_em DESC',
      [req.session.userId]
    );
    const media = r.rows.length
      ? (r.rows.reduce((s, a) => s + a.nota, 0) / r.rows.length).toFixed(1)
      : null;
    res.json({ avaliacoes: r.rows, media, total: r.rows.length });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── LISTA DE ESPERA ───────────────────────────────────────────

// POST /extras/lista-espera/:slug
router.post('/lista-espera/:slug', async (req, res) => {
  const { nome, email, telefone, data, horario } = req.body;
  if (!nome || !email || !telefone || !data) return res.status(400).json({ erro: 'Dados incompletos.' });
  try {
    const u = await pool.query('SELECT id FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (!u.rows.length) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    await pool.query(
      'INSERT INTO lista_espera (id, negocio_id, nome, email, telefone, data, horario, notificado, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)',
      [uuidv4(), u.rows[0].id, nome, email, telefone, data, horario || '', new Date().toLocaleString('pt-BR')]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// GET /extras/lista-espera — painel do dono
router.get('/lista-espera', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM lista_espera WHERE negocio_id=$1 AND notificado=false ORDER BY criado_em ASC',
      [req.session.userId]
    );
    res.json({ lista: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /extras/lista-espera/:id — remove da lista
router.delete('/lista-espera/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM lista_espera WHERE id=$1 AND negocio_id=$2', [req.params.id, req.session.userId]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// Notifica lista de espera quando abre vaga
async function notificarListaEspera(negocioId, data, horario) {
  try {
    const espera = await pool.query(
      `SELECT le.*, u.nome_negocio, u.slug, u.config FROM lista_espera le
       JOIN usuarios u ON le.negocio_id = u.id
       WHERE le.negocio_id=$1 AND le.data=$2 AND le.notificado=false
       ORDER BY le.criado_em ASC LIMIT 3`,
      [negocioId, data]
    );
    for (const p of espera.rows) {
      const link = `${process.env.BASE_URL || ''}/agendar/${p.slug}`;
      if (p.email) {
        try {
          await enviarEmail({
            fromName: 'AgendaOK',
            to: p.email,
            subject: `Vaga aberta em ${p.nome_negocio}!`,
            html: `<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:32px">
              <h2 style="color:#0d9488">Uma vaga abriu para voce!</h2>
              <p>Ola <strong>${p.nome}</strong>,</p>
              <p>Um horario em <strong>${p.nome_negocio}</strong> ficou disponivel para o dia <strong>${data}</strong>.</p>
              <p>Acesse agora para garantir o seu:</p>
              <a href="${link}" style="display:inline-block;background:#0d9488;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;margin-top:8px">Agendar agora</a>
              <p style="color:#64748b;font-size:12px;margin-top:24px">AgendaOK — Plataforma de agendamento online</p>
            </div>`,
          });
        } catch(e) { console.error('Notif espera:', e.message); }
      }
      await pool.query('UPDATE lista_espera SET notificado=true WHERE id=$1', [p.id]);
    }
  } catch(e) { console.error('Lista espera:', e.message); }
}

// ── HISTÓRICO DO CLIENTE ──────────────────────────────────────

// GET /extras/historico/:slug?email=...
router.get('/historico/:slug', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ erro: 'E-mail obrigatório.' });
  try {
    const u = await pool.query('SELECT id, nome_negocio FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (!u.rows.length) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const r = await pool.query(
      `SELECT id, nome, data, horario, servico, preco_servico, status, criado_em
       FROM agendamentos
       WHERE negocio_id=$1 AND email=$2
       ORDER BY data DESC, horario DESC`,
      [u.rows[0].id, email.toLowerCase().trim()]
    );
    res.json({ agendamentos: r.rows, negocio: u.rows[0].nome_negocio });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── RELATÓRIO MENSAL ──────────────────────────────────────────

async function enviarRelatorioMensal() {
  if (!process.env.RESEND_API_KEY && !process.env.EMAIL_USER) return;
  try {
    const usuarios = await pool.query('SELECT * FROM usuarios WHERE ativo=true');
    const mesPassado = new Date();
    mesPassado.setMonth(mesPassado.getMonth() - 1);
    const mes = mesPassado.toISOString().slice(0, 7);
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const nomeMes = meses[mesPassado.getMonth()];

    for (const u of usuarios.rows) {
      try {
        const ags = await pool.query(
          `SELECT * FROM agendamentos WHERE negocio_id=$1 AND data LIKE $2`,
          [u.id, mes + '%']
        );
        const total = ags.rows.length;
        const concluidos = ags.rows.filter(a => a.status === 'concluido').length;
        const cancelados = ags.rows.filter(a => a.status === 'cancelado').length;
        const faturamento = ags.rows
          .filter(a => a.status === 'concluido' && a.preco_servico)
          .reduce((s, a) => s + parseFloat(a.preco_servico || 0), 0);

        const avsR = await pool.query(
          'SELECT AVG(nota) as media, COUNT(*) as total FROM avaliacoes WHERE negocio_id=$1 AND criado_em LIKE $2',
          [u.id, `%/${mesPassado.getFullYear()}%`]
        );
        const mediaAv = avsR.rows[0].media ? parseFloat(avsR.rows[0].media).toFixed(1) : 'N/A';

        const servicosMap = {};
        ags.rows.forEach(a => {
          if (a.servico) servicosMap[a.servico] = (servicosMap[a.servico] || 0) + 1;
        });
        const topServicos = Object.entries(servicosMap).sort((a,b)=>b[1]-a[1]).slice(0,3);

        await enviarEmail({
          fromName: 'AgendaOK',
          to: u.email,
          subject: `Relatorio de ${nomeMes} — ${u.nome_negocio}`,
          html: `
<div style="font-family:Arial;max-width:560px;margin:0 auto;background:#f8faff;padding:0;border-radius:16px;overflow:hidden">
  <div style="background:#0d9488;padding:32px;text-align:center;color:white">
    <div style="font-size:13px;opacity:0.8;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em">AgendaOK — Relatorio Mensal</div>
    <h1 style="margin:0;font-size:26px;font-weight:800">${nomeMes} ${mesPassado.getFullYear()}</h1>
    <p style="margin:8px 0 0;opacity:0.9">${u.nome_negocio}</p>
  </div>
  <div style="padding:28px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">
      <div style="background:white;border-radius:12px;padding:20px;text-align:center;border:1.5px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:8px">Total de agendamentos</div>
        <div style="font-size:40px;font-weight:900;color:#0d9488">${total}</div>
      </div>
      <div style="background:white;border-radius:12px;padding:20px;text-align:center;border:1.5px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:8px">Concluidos</div>
        <div style="font-size:40px;font-weight:900;color:#16a34a">${concluidos}</div>
      </div>
      <div style="background:white;border-radius:12px;padding:20px;text-align:center;border:1.5px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:8px">Cancelamentos</div>
        <div style="font-size:40px;font-weight:900;color:#dc2626">${cancelados}</div>
      </div>
      <div style="background:white;border-radius:12px;padding:20px;text-align:center;border:1.5px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:8px">Avaliacao media</div>
        <div style="font-size:40px;font-weight:900;color:#f59e0b">${mediaAv}</div>
      </div>
    </div>
    ${faturamento > 0 ? `
    <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
      <div style="font-size:13px;color:#15803d;font-weight:700;margin-bottom:8px">FATURAMENTO ESTIMADO DO MES</div>
      <div style="font-size:36px;font-weight:900;color:#15803d">R$ ${faturamento.toFixed(2).replace('.', ',')}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">Baseado nos atendimentos concluidos com preco</div>
    </div>` : ''}
    ${topServicos.length ? `
    <div style="background:white;border-radius:12px;padding:20px;margin-bottom:20px;border:1.5px solid #e2e8f0">
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:14px">Servicos mais solicitados</div>
      ${topServicos.map(([nome, qtd], i) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px">
          <span style="color:#334155">${i+1}. ${nome}</span>
          <span style="font-weight:700;color:#0d9488">${qtd}x</span>
        </div>`).join('')}
    </div>` : ''}
    <div style="text-align:center">
      <a href="${process.env.BASE_URL||''}/painel" style="display:inline-block;background:#0d9488;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700">Acessar meu painel</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin-top:20px">AgendaOK — Este relatorio e enviado automaticamente todo mes</p>
  </div>
</div>`,
        });
        console.log(` Relatorio enviado para ${u.email}`);
      } catch(e) { console.error(`Relatorio ${u.email}:`, e.message); }
    }
  } catch(e) { console.error('Relatorio mensal:', e.message); }
}

router.get('/relatorio-teste', requireAuth, async (req, res) => {
  await enviarRelatorioMensal();
  res.json({ sucesso: true, msg: 'Relatorio enviado!' });
});

// GET /extras/reagendar/:token — dados do agendamento para reagendar
router.get('/reagendar/:token', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.nome, a.data, a.horario, a.servico, a.status,
              a.negocio_slug, u.nome_negocio, u.config
       FROM agendamentos a
       JOIN usuarios u ON u.id = a.negocio_id
       WHERE a.token_cancel = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido ou expirado.' });
    const ag = r.rows[0];
    if (ag.status === 'cancelado') return res.status(400).json({ erro: 'Este agendamento foi cancelado.' });
    res.json({ agendamento: ag });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// POST /extras/reagendar/:token — confirmar novo horário
router.post('/reagendar/:token', async (req, res) => {
  const { nova_data, novo_horario } = req.body;
  if (!nova_data || !novo_horario) return res.status(400).json({ erro: 'Data e horário obrigatórios.' });
  try {
    const r = await pool.query(
      'SELECT * FROM agendamentos WHERE token_cancel = $1', [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Link inválido.' });
    const ag = r.rows[0];
    if (ag.status === 'cancelado') return res.status(400).json({ erro: 'Agendamento cancelado.' });

    // Verificar se horário está disponível
    const ocupado = await pool.query(
      `SELECT id FROM agendamentos
       WHERE negocio_id=$1 AND data=$2 AND horario=$3
         AND status IN ('pendente','confirmado','reagendado')
         AND id != $4`,
      [ag.negocio_id, nova_data, novo_horario, ag.id]
    );
    if (ocupado.rows.length) return res.status(409).json({ erro: 'Este horário já está ocupado. Escolha outro.' });

    const agora = new Date().toLocaleString('pt-BR');
    await pool.query(
      `UPDATE agendamentos SET data=$1, horario=$2, status='reagendado', atualizado_em=$3 WHERE id=$4`,
      [nova_data, novo_horario, agora, ag.id]
    );

    // Notificação no sino do dono
    await pool.query(
      `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
       VALUES (gen_random_uuid(), $1, 'aviso', $2, $3)`,
      [ag.negocio_id, `🔄 Reagendamento: ${ag.nome}`, `Reagendou para ${nova_data} às ${novo_horario}`]
    ).catch(() => {});

    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
module.exports.enviarRelatorioMensal = enviarRelatorioMensal;
