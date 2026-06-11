const express = require('express');
const router  = express.Router();

// Data de hoje no fuso de Brasília (UTC-3)
function hojeBR() {
  return new Date(Date.now() - 3*60*60*1000).toISOString().split('T')[0];
}
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { enviarConfirmacao } = require('../middleware/email');
const { enviarEmail } = require('../middleware/mailer');
const { enviarPushUsuario } = require('../middleware/push');

// ── Helpers de agenda (duração do serviço + equipe) ─────────────────────────
function minutos(h) {
  const [hh, mm] = (h || '0:0').split(':').map(Number);
  return hh * 60 + (mm || 0);
}

// Ocupações do dia com a duração real do serviço (quando conhecida).
// Agendamento sem serviço vinculado ocupa apenas o próprio slot (comportamento antigo).
async function buscarOcupacoes(negocioId, data) {
  const rows = (await pool.query(
    `SELECT a.horario, a.funcionario_id, s.duracao
     FROM agendamentos a
     LEFT JOIN servicos s ON s.id = a.servico_id
     WHERE a.negocio_id=$1 AND a.data=$2 AND a.status IN ('pendente','confirmado','reagendado')`,
    [negocioId, data]
  )).rows;
  return rows.map(r => {
    const ini = minutos(r.horario);
    const dur = parseInt(r.duracao) || 0;
    return { ini, fim: ini + Math.max(dur, 1), func: r.funcionario_id || null };
  });
}

async function contarProfissionais(negocioId) {
  return +(await pool.query(
    'SELECT COUNT(*) FROM funcionarios WHERE negocio_id=$1 AND ativo=true', [negocioId]
  )).rows[0].count;
}

// Conflito de um novo agendamento [ini, ini+dur):
// — Sem equipe: qualquer sobreposição bloqueia (1 atendimento por vez).
// — Com equipe: profissional escolhido ocupado bloqueia; senão bloqueia
//   apenas quando TODOS os profissionais estão ocupados (capacidade cheia).
function temConflito({ ini, dur, funcionarioId, ocupacoes, numProfs }) {
  const fim = ini + Math.max(parseInt(dur) || 0, 1);
  const sobrepostos = ocupacoes.filter(o => ini < o.fim && o.ini < fim);
  if (numProfs > 0) {
    if (funcionarioId && sobrepostos.some(o => o.func === funcionarioId)) return true;
    return sobrepostos.length >= numProfs;
  }
  return sobrepostos.length >= 1;
}

router.get('/:slug/info', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const u = r.rows[0];

    // Prova social: média e total de avaliações
    let avaliacao = { media: null, total: 0 };
    try {
      const av = (await pool.query(
        'SELECT ROUND(AVG(nota)::numeric, 1) AS media, COUNT(*) AS total FROM avaliacoes WHERE negocio_id=$1',
        [u.id]
      )).rows[0];
      if (parseInt(av.total) > 0) avaliacao = { media: parseFloat(av.media), total: parseInt(av.total) };
    } catch(_) {}

    res.json({ nome_negocio: u.nome_negocio, nicho: u.nicho, foto_url: u.foto_url||'',
      avaliacao,
      config: { horarios: u.config.horarios, dias_uteis: u.config.dias_uteis, telefone: u.config.telefone, descricao: u.config.descricao, cor: u.config.cor } });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.get('/:slug/horarios', async (req, res) => {
  const { data, funcionario_id, dur } = req.query;
  if (!data) return res.status(400).json({ erro: 'Data obrigatória.' });
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const u = r.rows[0];
    // Verifica dias bloqueados apenas se o dono configurou restrição
    const diasUteisCfg = u.config.dias_uteis ? u.config.dias_uteis.trim() : '';
    if(diasUteisCfg) {
      const diasUteis = diasUteisCfg.split(',').map(Number);
      const diaSemana = new Date(data+'T12:00:00').getDay();
      if (!diasUteis.includes(diaSemana)) return res.json({ horarios: [], mensagem: 'Dia não disponível.' });
    }
    const hoje   = hojeBR();
    // Hora atual em Brasília (UTC-3) para filtrar horários já passados
    const agoraBR   = new Date(Date.now() - 3*60*60*1000);
    if (data < hoje) return res.json({ horarios: [], mensagem: 'Data no passado.' });

    const todos = (u.config.horarios||'').split(',').map(h=>h.trim()).filter(Boolean);
    const intervalo = parseInt(u.config.intervalo) || 0;

    // Ocupações (com duração do serviço) + tamanho da equipe
    const [ocupacoes, numProfs] = await Promise.all([
      buscarOcupacoes(u.id, data),
      contarProfissionais(u.id),
    ]);

    // Horários bloqueados pelo dono (dia inteiro ou horário específico)
    const bloqRows = (await pool.query(
      'SELECT horario FROM horarios_bloqueados WHERE negocio_id=$1 AND data=$2',
      [u.id, data]
    )).rows;

    const bloqueados = new Set();
    for (const b of bloqRows) {
      if (b.horario === 'todos') {
        // Dia inteiro bloqueado — retorna tudo indisponível
        return res.json({ horarios: todos.map(h => ({ horario: h, disponivel: false, motivo: 'bloqueado' })) });
      }
      bloqueados.add(b.horario);
    }

    // Se for hoje, filtra horários que já passaram (com 30 min de antecedência)
    const isHoje = data === hoje;
    const limiteMin = isHoje ? agoraBR.getUTCHours() * 60 + agoraBR.getUTCMinutes() + 30 : 0;
    const durNova = parseInt(dur) || 0; // duração do serviço sendo agendado (opcional)

    const result = todos.map(h => {
      const m = minutos(h);
      const jaPassou  = isHoje && m < limiteMin;
      const bloqueado = bloqueados.has(h);
      const ocupado   = !bloqueado && !jaPassou && temConflito({
        ini: m, dur: durNova,
        funcionarioId: funcionario_id || null,
        ocupacoes, numProfs,
      });

      // Intervalo de respiro entre atendimentos (configurável pelo dono)
      let conflitoIntervalo = false;
      if (intervalo > 0 && !bloqueado && !jaPassou && !ocupado) {
        conflitoIntervalo = ocupacoes.some(o => {
          const d = Math.abs(m - o.ini);
          return d > 0 && d < intervalo;
        });
      }

      return {
        horario:    h,
        disponivel: !bloqueado && !jaPassou && !ocupado && !conflitoIntervalo,
        motivo:     bloqueado          ? 'ocupado'
                  : ocupado            ? 'ocupado'
                  : jaPassou           ? 'passado'
                  : conflitoIntervalo  ? 'intervalo'
                  : null,
      };
    });

    res.json({ horarios: result });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

router.post('/:slug/agendar', async (req, res) => {
  const { nome, email, telefone, servico, servico_id, preco_servico, data, horario, obs, funcionario_id, funcionario_nome } = req.body;
  if (!nome || !telefone || !data || !horario)
    return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Negócio não encontrado.' });
    const u = r.rows[0];
    // Conflito considerando duração do serviço e equipe (mesma regra da listagem)
    let durNova = 0;
    if (servico_id) {
      const s = (await pool.query(
        'SELECT duracao FROM servicos WHERE id=$1 AND negocio_id=$2', [servico_id, u.id]
      )).rows[0];
      durNova = s ? (parseInt(s.duracao) || 0) : 0;
    }
    const [ocupacoes, numProfs] = await Promise.all([
      buscarOcupacoes(u.id, data),
      contarProfissionais(u.id),
    ]);
    if (temConflito({ ini: minutos(horario), dur: durNova, funcionarioId: funcionario_id || null, ocupacoes, numProfs })) {
      return res.status(409).json({ erro: 'Horário já reservado. Escolha outro.' });
    }

    const agora   = new Date().toLocaleString('pt-BR');
    const tokenC  = uuidv4().replace(/-/g,'');
    const tokenA  = uuidv4().replace(/-/g,'');
    const tokenCF = uuidv4().replace(/-/g,'');
    const agId    = uuidv4();
    const base    = process.env.BASE_URL || '';

    await pool.query(
      `INSERT INTO agendamentos (id,negocio_id,negocio_slug,nome,email,telefone,servico,servico_id,preco_servico,obs,data,horario,status,token_cancel,token_avalia,token_confirm,funcionario_id,criado_em,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendente',$13,$14,$15,$16,$17,$17)`,
      [agId, u.id, u.slug, nome.trim(), email.trim().toLowerCase(), telefone.trim(),
       servico||'', servico_id||null, preco_servico||null, obs||'', data, horario,
       tokenC, tokenA, tokenCF, funcionario_id||null, agora]
    );

    const [ano, mes, dia] = data.split('-');
    const dataFmt = `${dia}/${mes}/${ano}`;
    const linkConfirmar = `${base}/confirmar/${tokenCF}`;

    // Notifica o dono via WhatsApp (gera link pronto)
    const telDono = u.config?.telefone?.replace(/\D/g,'');
    if (telDono) {
      const numDono = telDono.length <= 11 ? '55'+telDono : telDono;
      const msgDono = encodeURIComponent(
        `Novo agendamento em ${u.nome_negocio}!\n\n` +
        `Cliente: ${nome.trim()}\n` +
        `WhatsApp: ${telefone.trim()}\n` +
        `Data: ${dataFmt}\n` +
        `Horario: ${horario}\n` +
        (funcionario_nome ? `Profissional: ${funcionario_nome}\n` : '') +
        (servico ? `Servico: ${servico}\n` : '') +
        `\nConfirme com 1 clique:\n${linkConfirmar}`
      );
      // Salva o link para retornar ao cliente (opcional)
    }

    // Push no celular do dono (se ativado)
    enviarPushUsuario(u.id, {
      titulo: '📅 Novo agendamento!',
      corpo: `${nome.trim()} • ${dataFmt} às ${horario}${servico ? ' · ' + servico : ''}`,
      urgente: true,
    }).catch(() => {});

    // E-mail com links de cancelar e avaliar
    enviarConfirmacaoCompleta({
      nomeCliente: nome.trim(), emailCliente: email.trim().toLowerCase(),
      nomeNegocio: u.nome_negocio, data, horario, servico: servico||'',
      preco: preco_servico, corNegocio: u.config.cor||'#0d9488',
      emailNegocio: u.config.email_negocio||'', senhaEmailNegocio: u.config.email_senha||'',
      linkCancelar: `${base}/cancelar/${tokenC}`,
      linkAvaliar:  `${base}/avaliar/${tokenA}`,
    }).catch(e=>console.error('Email:',e.message));

    // Retorna o link de confirmação para o dono poder enviar pelo WhatsApp
    const telDonoNum = telDono ? (telDono.length <= 11 ? '55'+telDono : telDono) : null;
    const msgWppDono = telDonoNum
      ? `https://wa.me/${telDonoNum}?text=${encodeURIComponent(
          `Novo agendamento em ${u.nome_negocio}!\n\n` +
          `Cliente: ${nome.trim()}\n` +
          `WhatsApp: ${telefone.trim()}\n` +
          `Data: ${dataFmt}\n` +
          `Horario: ${horario}\n` +
          (servico ? `Servico: ${servico}\n` : '') +
          `\nConfirme com 1 clique:\n${linkConfirmar}`
        )}`
      : null;

    res.status(201).json({ sucesso: true, link_confirmar: linkConfirmar, wpp_dono: msgWppDono });
  } catch(e) { console.error(e); res.status(500).json({ erro: 'Erro interno.' }); }
});

async function enviarConfirmacaoCompleta({ nomeCliente, emailCliente, nomeNegocio, data, horario, servico, preco, corNegocio, emailNegocio, senhaEmailNegocio, linkCancelar, linkAvaliar }) {
  if (!emailCliente) return;

  const [ano, mes, dia] = data.split('-');
  const dataFmt = `${dia}/${mes}/${ano}`;
  const cor = corNegocio || '#0d9488';
  const precoTxt = preco ? `R$ ${parseFloat(preco).toFixed(2).replace('.', ',')}` : '';

  await enviarEmail({
    fromName: nomeNegocio,
    gmailUser: emailNegocio, gmailPass: senhaEmailNegocio,
    to: emailCliente,
    subject: `Agendamento confirmado — ${nomeNegocio} • ${dataFmt} as ${horario}`,
    html: `
<div style="font-family:Arial;max-width:560px;margin:0 auto;background:#f8faff;padding:0;border-radius:16px;overflow:hidden">
  <div style="background:${cor};padding:32px;text-align:center;color:white">
    <h1 style="margin:0;font-size:24px;font-weight:800">Agendamento Confirmado</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:15px">${nomeNegocio}</p>
  </div>
  <div style="padding:28px">
    <p style="font-size:16px;color:#334155;margin:0 0 20px">Ola, <strong>${nomeCliente}</strong>. Seu agendamento foi realizado com sucesso.</p>
    <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600;width:40%">Data</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#0f172a">${dataFmt}</td></tr>
        <tr style="border-top:1px solid #dcfce7"><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600">Horario</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#0f172a">${horario}</td></tr>
        <tr style="border-top:1px solid #dcfce7"><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600">Local</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#0f172a">${nomeNegocio}</td></tr>
        ${servico ? `<tr style="border-top:1px solid #dcfce7"><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600">Servico</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#0f172a">${servico}${precoTxt?' — '+precoTxt:''}</td></tr>` : ''}
      </table>
    </div>
    <div style="background:#fff7ed;border:2px solid #fed7aa;border-radius:12px;padding:16px;margin-bottom:20px">
      <p style="margin:0;font-size:13px;color:#92400e;font-weight:600">Precisa cancelar? Clique no botao abaixo com ate 24h de antecedencia.</p>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a href="${linkCancelar}" style="background:#dc2626;color:white;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Cancelar agendamento</a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin-top:20px">Apos o atendimento, voce receberá um link para avaliar o servico.</p>
  </div>
</div>`,
  });
}

// GET /p/:slug/equipe — funcionários ativos do negócio (para página pública)
router.get('/:slug/equipe', async (req, res) => {
  try {
    const u = (await pool.query(
      'SELECT id FROM usuarios WHERE slug=$1 AND ativo=true', [req.params.slug]
    )).rows[0];
    if (!u) return res.json({ funcionarios: [] });

    const r = await pool.query(
      'SELECT id, nome, cargo, cor FROM funcionarios WHERE negocio_id=$1 AND ativo=true ORDER BY nome ASC',
      [u.id]
    );
    res.json({ funcionarios: r.rows });
  } catch(e) { res.json({ funcionarios: [] }); }
});

module.exports = router;
