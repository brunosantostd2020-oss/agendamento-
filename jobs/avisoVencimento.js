const { pool }        = require('../middleware/database');
const { enviarEmail } = require('../middleware/mailer');

const BASE_URL = () => process.env.APP_URL || 'https://agendamento-production-e1a3.up.railway.app';

async function enviarEmailRenovacao({ nome, email, nomeNegocio, diasRestantes, linkRenovacao }) {
  const urgente = diasRestantes <= 0;
  const titulo  = urgente
    ? '🚨 Seu acesso AgendaOK venceu hoje!'
    : `⏰ Seu acesso AgendaOK vence em ${diasRestantes} dia${diasRestantes > 1 ? 's' : ''}`;
  const corTopo = urgente ? '#dc2626' : '#f97316';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f8faff;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:${corTopo};padding:32px;text-align:center">
    <h1 style="color:white;margin:0;font-size:22px;font-weight:800">${titulo}</h1>
    <p style="color:rgba(255,255,255,0.9);margin:10px 0 0;font-size:14px">${nomeNegocio} — AgendaOK</p>
  </div>
  <div style="padding:32px">
    <p style="font-size:16px;color:#334155;margin:0 0 20px">Olá, <strong>${nome}</strong>! 👋</p>
    ${urgente
      ? `<div style="background:#fef2f2;border:2px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:20px">
           <p style="margin:0;font-size:15px;color:#dc2626;font-weight:700">🚨 Seu acesso venceu hoje. Renove agora para não perder seus dados e agendamentos.</p>
         </div>`
      : `<div style="background:#fff7ed;border:2px solid #fed7aa;border-radius:12px;padding:20px;margin-bottom:20px">
           <p style="margin:0;font-size:15px;color:#92400e;font-weight:700">⏰ Faltam <strong>${diasRestantes} dia${diasRestantes > 1 ? 's' : ''}</strong> para seu acesso expirar. Renove agora para não ter interrupções!</p>
         </div>`}
    <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:13px;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Plano Pro AgendaOK</div>
      <div style="font-size:44px;font-weight:900;color:#0f172a;line-height:1">R$69<span style="font-size:22px">,90</span></div>
      <div style="font-size:13px;color:#64748b;margin-top:4px">por mês • PIX, débito ou crédito</div>
    </div>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${linkRenovacao}" style="display:inline-block;background:#16a34a;color:white;padding:16px 40px;border-radius:12px;font-weight:800;font-size:16px;text-decoration:none">
        🔄 Renovar acesso agora →
      </a>
      <p style="margin:10px 0 0;font-size:12px;color:#94a3b8">Clique para renovar via PIX, débito ou cartão</p>
    </div>
    <div style="background:#f8faff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">Sem renovação você perde:</div>
      <div style="font-size:13px;color:#475569;line-height:1.9">❌ Novos agendamentos &nbsp; ❌ Painel e relatórios<br/>❌ Página pública &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ❌ Gestão da equipe</div>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">Dúvidas? Responda este e-mail.<br/>© 2025 AgendaOK</p>
  </div>
</div></body></html>`;

  await enviarEmail({ fromName: 'AgendaOK', to: email, subject: titulo, html });
}

async function rodarAvisoVencimento() {
  console.log('🔔 Job aviso vencimento iniciado...');
  try {
    const { rows } = await pool.query(`
      SELECT id, nome, email, nome_negocio, acesso_expira, plano_pago,
             trial_expira, acesso_ativo
      FROM usuarios
      WHERE acesso_ativo = true
        AND (
          (plano_pago = true  AND acesso_expira IS NOT NULL AND acesso_expira != ''
           AND TO_DATE(acesso_expira, 'YYYY-MM-DD') >= CURRENT_DATE
           AND TO_DATE(acesso_expira, 'YYYY-MM-DD') <= CURRENT_DATE + INTERVAL '2 days')
          OR
          (plano_pago = false AND trial_expira IS NOT NULL AND trial_expira != ''
           AND TO_DATE(trial_expira, 'YYYY-MM-DD') >= CURRENT_DATE
           AND TO_DATE(trial_expira, 'YYYY-MM-DD') <= CURRENT_DATE + INTERVAL '2 days')
        )
    `);

    console.log(`📋 ${rows.length} usuário(s) com vencimento próximo`);

    for (const u of rows) {
      const dataVenc = u.plano_pago ? u.acesso_expira : u.trial_expira;
      if (!dataVenc) continue;

      const hoje  = new Date(); hoje.setHours(0,0,0,0);
      const venc  = new Date(dataVenc + 'T12:00:00');
      const dias  = Math.ceil((venc - hoje) / 86400000);

      if (dias !== 2 && dias !== 1 && dias !== 0) continue;

      const link      = `${BASE_URL()}/assinar`;
      const tituloN   = dias === 0 ? '🚨 Acesso venceu hoje!' : `⏰ Acesso vence em ${dias} dia${dias > 1 ? 's' : ''}!`;
      const msgN      = dias === 0
        ? 'Seu acesso expirou. Clique aqui para renovar e continuar usando o AgendaOK.'
        : `Faltam ${dias} dia${dias > 1 ? 's' : ''} para seu acesso expirar. Renove agora!`;

      // Notificação no sino (sem duplicar no mesmo dia)
      await pool.query(
        `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
         SELECT gen_random_uuid(),$1,'aviso',$2,$3
         WHERE NOT EXISTS (
           SELECT 1 FROM notificacoes
           WHERE usuario_id=$1 AND titulo=$2
             AND criado_em::date = CURRENT_DATE
         )`,
        [u.id, tituloN, msgN]
      ).catch(e => console.error('Notif sino erro:', e.message));

      // E-mail de renovação
      await enviarEmailRenovacao({
        nome: u.nome, email: u.email,
        nomeNegocio: u.nome_negocio,
        diasRestantes: dias, linkRenovacao: link,
      });
    }

    console.log('✅ Job aviso vencimento concluído');
  } catch(e) {
    console.error('❌ Erro job vencimento:', e.message);
  }
}

module.exports = { rodarAvisoVencimento };
