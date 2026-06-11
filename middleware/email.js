const { enviarEmail } = require('./mailer');

// ── 1. Boas-vindas ao novo cadastro ─────────────────────────

async function enviarBoasVindas({ nome, email, senha, nomeNegocio, nicho, plano, slug }) {
  const planoNomes = { pro: 'Pro — R$ 69,90/mês', basico: 'Pro — R$ 69,90/mês', profissional: 'Pro — R$ 69,90/mês', premium: 'Pro — R$ 69,90/mês' };
  const linkPainel = process.env.BASE_URL ? process.env.BASE_URL + '/painel' : 'seu-site.railway.app/painel';
  const linkAgendar = process.env.BASE_URL ? process.env.BASE_URL + '/agendar/' + slug : 'seu-site.railway.app/agendar/' + slug;

  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    
    <div style="background:linear-gradient(135deg,#0d9488,#0a7c72);padding:36px;text-align:center">
      <div style="background:rgba(255,255,255,0.2);display:inline-block;border-radius:10px;padding:6px 18px;margin-bottom:14px">
        <span style="color:white;font-size:13px;font-weight:700;letter-spacing:0.08em">AGENDA OK</span>
      </div>
      <h1 style="color:white;margin:0;font-size:26px;font-weight:800">🎉 Bem-vindo ao AgendaOK!</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:15px">Sua conta foi criada com sucesso</p>
    </div>

    <div style="padding:32px">
      <p style="font-size:16px;color:#334155;margin:0 0 24px">
        Olá, <strong>${nome}</strong>! 👋<br/>
        Sua conta no AgendaOK está pronta. Veja os detalhes abaixo:
      </p>

      <!-- Dados de acesso -->
      <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:20px">
        <h2 style="margin:0 0 16px;font-size:14px;color:#15803d;text-transform:uppercase;letter-spacing:0.06em">🔐 Seus dados de acesso</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600;width:35%">E-mail</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${email}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Senha</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${senha}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Negócio</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${nomeNegocio}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Nicho</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${nicho}</td>
          </tr>
        </table>
      </div>

      <!-- Plano -->
      <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:24px;margin-bottom:20px">
        <h2 style="margin:0 0 16px;font-size:14px;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.06em">📦 Plano escolhido</h2>
        <p style="margin:0;font-size:18px;font-weight:800;color:#1e3a5f">${planoNomes[plano] || 'Pro — R$ 69,90/mês'}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b">Você tem <strong>7 dias grátis</strong> para testar tudo. Depois, assine direto pelo painel.</p>
      </div>

      <!-- Links -->
      <div style="text-align:center;margin-bottom:24px">
        <a href="${linkPainel}" style="display:inline-block;background:#0d9488;color:white;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:10px">
          Acessar meu painel →
        </a>
        <br/>
        <a href="${linkAgendar}" style="font-size:13px;color:#0d9488;text-decoration:none;font-weight:600">
          Ver minha página pública de agendamento
        </a>
      </div>

      <p style="font-size:13px;color:#94a3b8;text-align:center;margin:0">
        Guarde este e-mail! Ele contém seus dados de acesso.<br/>
        © 2025 AgendaOK
      </p>
    </div>
  </div>
</body></html>`;

  return enviarEmail({
    fromName: 'AgendaOK',
    to: email,
    subject: `🎉 Bem-vindo ao AgendaOK, ${nome}! Seus dados de acesso`,
    html,
  });
}

// ── 2. E-mail de pagamento ───────────────────────────────────

async function enviarInstrucoesPagamento({ nome, email, plano, nomeNegocio }) {
  const linkAssinar = (process.env.BASE_URL || '') + '/assinar';

  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <div style="background:linear-gradient(135deg,#0d9488,#0a7c72);padding:36px;text-align:center">
      <div style="background:rgba(255,255,255,0.2);display:inline-block;border-radius:10px;padding:6px 18px;margin-bottom:14px">
        <span style="color:white;font-size:13px;font-weight:700;letter-spacing:0.08em">AGENDA OK</span>
      </div>
      <h1 style="color:white;margin:0;font-size:24px;font-weight:800">🚀 Seu teste grátis começou!</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px">${nomeNegocio} — 7 dias com acesso completo</p>
    </div>

    <div style="padding:32px">
      <p style="font-size:16px;color:#334155;margin:0 0 24px">
        Olá, <strong>${nome}</strong>! 👋<br/>
        Você tem <strong>7 dias grátis</strong> para usar tudo: agendamentos ilimitados, equipe,
        relatórios e notificações. Quando quiser garantir seu acesso, é só assinar pelo painel.
      </p>

      <!-- Oferta de fundador -->
      <div style="background:linear-gradient(135deg,#fff7ed,#fef2f2);border:2px solid #fdba74;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
        <div style="font-size:12px;font-weight:800;color:#ea580c;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🔥 Oferta de fundador — vagas limitadas</div>
        <div style="font-size:15px;color:#334155">Os primeiros assinantes pagam</div>
        <div style="font-size:38px;font-weight:900;color:#0f172a;line-height:1.2">R$ 39,90<span style="font-size:16px;font-weight:600;color:#64748b">/mês</span></div>
        <div style="font-size:13px;color:#64748b"><s>de R$ 69,90</s> — e o preço fica <strong>travado para sempre</strong></div>
      </div>

      <!-- Como pagar -->
      <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px">
        <h2 style="margin:0 0 10px;font-size:14px;color:#15803d;text-transform:uppercase">💚 Pagamento simples e seguro</h2>
        <p style="margin:0;font-size:14px;color:#334155;line-height:1.7">
          PIX, cartão de crédito (até 12x) ou débito, direto pelo <strong>Mercado Pago</strong>.
          Sem fidelidade — cancele quando quiser.
        </p>
      </div>

      <div style="text-align:center;margin-bottom:24px">
        <a href="${linkAssinar}" style="display:inline-block;background:#0d9488;color:white;padding:16px 40px;border-radius:12px;font-weight:800;font-size:16px;text-decoration:none">
          Garantir minha vaga →
        </a>
      </div>

      <p style="font-size:13px;color:#94a3b8;text-align:center;margin:0">
        Dúvidas? Responda este e-mail.<br/>
        © 2026 AgendaOK
      </p>
    </div>
  </div>
</body></html>`;

  return enviarEmail({
    fromName: 'AgendaOK',
    to: email,
    subject: `🚀 Seu teste grátis de 7 dias começou — AgendaOK`,
    html,
  });
}

// ── 3. Confirmação de agendamento (pelo negócio) ─────────────

async function enviarConfirmacao({ nomeCliente, emailCliente, nomeNegocio, nicho, data, horario, servico, corNegocio, emailNegocio, senhaEmailNegocio }) {
  const [ano, mes, dia] = data.split('-');
  const dataFmt = `${dia}/${mes}/${ano}`;
  const cor = corNegocio || '#0d9488';

  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:${cor};padding:32px;text-align:center">
      <h1 style="color:white;margin:0;font-size:26px;font-weight:800">✅ Agendamento Confirmado!</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:15px">${nomeNegocio}</p>
    </div>
    <div style="padding:32px">
      <p style="font-size:16px;color:#334155;margin:0 0 24px">
        Olá, <strong>${nomeCliente}</strong>! 👋<br/>
        Seu agendamento foi realizado com sucesso.
      </p>
      <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600;width:35%">📅 Data</td><td style="padding:8px 0;font-size:14px;font-weight:700">${dataFmt}</td></tr>
          <tr style="border-top:1px solid #dcfce7"><td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">🕐 Horário</td><td style="padding:8px 0;font-size:14px;font-weight:700">${horario}</td></tr>
          <tr style="border-top:1px solid #dcfce7"><td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">🏢 Local</td><td style="padding:8px 0;font-size:14px;font-weight:700">${nomeNegocio}</td></tr>
          ${servico ? `<tr style="border-top:1px solid #dcfce7"><td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">✂️ Serviço</td><td style="padding:8px 0;font-size:14px;font-weight:700">${servico}</td></tr>` : ''}
        </table>
      </div>
      <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="margin:0;font-size:13px;color:#92400e;font-weight:600">⏰ Chegue com alguns minutos de antecedência. Em caso de imprevistos entre em contato com o estabelecimento.</p>
      </div>
      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">Powered by <strong style="color:${cor}">AgendaOK</strong></p>
    </div>
  </div>
</body></html>`;

  return enviarEmail({
    fromName: nomeNegocio,
    gmailUser: emailNegocio, gmailPass: senhaEmailNegocio,
    to: emailCliente,
    subject: `✅ Agendamento confirmado — ${nomeNegocio} • ${dataFmt} às ${horario}`,
    html,
  });
}

module.exports = { enviarBoasVindas, enviarInstrucoesPagamento, enviarConfirmacao };
