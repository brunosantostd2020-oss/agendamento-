const nodemailer = require('nodemailer');

// ── Transporters ────────────────────────────────────────────

function criarTransporterPrincipal() {
  if (!process.env.EMAIL_USER) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

function criarTransporterNegocio(emailUser, emailPass) {
  if (!emailUser || !emailPass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: emailUser, pass: emailPass },
  });
}

// ── 1. Boas-vindas ao novo cadastro ─────────────────────────

async function enviarBoasVindas({ nome, email, senha, nomeNegocio, nicho, plano, slug }) {
  const t = criarTransporterPrincipal();
  if (!t) { console.log('⚠️  EMAIL_USER não configurado. Pulando boas-vindas.'); return false; }

  const planoNomes = { basico: 'Básico — R$49/mês', profissional: 'Profissional — R$99/mês', premium: 'Premium — R$199/mês' };
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
        <p style="margin:0;font-size:18px;font-weight:800;color:#1e3a5f">${planoNomes[plano] || plano}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b">Você tem 14 dias grátis para testar. Veja abaixo como realizar o pagamento.</p>
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

  try {
    await t.sendMail({
      from: `"AgendaOK" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `🎉 Bem-vindo ao AgendaOK, ${nome}! Seus dados de acesso`,
      html,
    });
    console.log(`✅ Boas-vindas enviadas para ${email}`);
    return true;
  } catch(e) {
    console.error('❌ Erro boas-vindas:', e.message);
    return false;
  }
}

// ── 2. E-mail de pagamento ───────────────────────────────────

async function enviarInstrucoesPagamento({ nome, email, plano, nomeNegocio }) {
  const t = criarTransporterPrincipal();
  if (!t) return false;

  const planos = {
    basico:       { nome: 'Básico',       preco: 'R$49,00', desc: 'Até 2 profissionais' },
    profissional: { nome: 'Profissional', preco: 'R$99,00', desc: 'Até 10 profissionais + WhatsApp' },
    premium:      { nome: 'Premium',      preco: 'R$199,00',desc: 'Profissionais ilimitados' },
  };
  const p = planos[plano] || { nome: plano, preco: '—', desc: '' };

  const pixChave   = process.env.PIX_CHAVE   || 'seupix@email.com';
  const pixNome    = process.env.PIX_NOME    || 'AgendaOK';
  const pixBanco   = process.env.PIX_BANCO   || 'Banco do Brasil';

  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    
    <div style="background:linear-gradient(135deg,#1d4ed8,#1e40af);padding:36px;text-align:center">
      <div style="background:rgba(255,255,255,0.2);display:inline-block;border-radius:10px;padding:6px 18px;margin-bottom:14px">
        <span style="color:white;font-size:13px;font-weight:700">AGENDA OK</span>
      </div>
      <h1 style="color:white;margin:0;font-size:24px;font-weight:800">💳 Instruções de Pagamento</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px">Finalize sua assinatura do plano ${p.nome}</p>
    </div>

    <div style="padding:32px">
      <p style="font-size:16px;color:#334155;margin:0 0 24px">
        Olá, <strong>${nome}</strong>! 👋<br/>
        Para ativar seu plano <strong>${p.nome}</strong>, realize o pagamento abaixo.
      </p>

      <!-- Resumo do plano -->
      <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:20px;margin-bottom:20px">
        <h2 style="margin:0 0 12px;font-size:14px;color:#1d4ed8;text-transform:uppercase">📦 Seu plano</h2>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:18px;font-weight:800;color:#0f172a">${p.nome}</div>
            <div style="font-size:13px;color:#64748b">${p.desc}</div>
          </div>
          <div style="font-size:28px;font-weight:900;color:#1d4ed8">${p.preco}<span style="font-size:14px;font-weight:500;color:#64748b">/mês</span></div>
        </div>
      </div>

      <!-- Dados para pagamento -->
      <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:20px">
        <h2 style="margin:0 0 16px;font-size:14px;color:#15803d;text-transform:uppercase">💚 Pagar via PIX</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600;width:35%">Chave PIX</td>
            <td style="padding:8px 0;font-size:15px;color:#0f172a;font-weight:800">${pixChave}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Nome</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${pixNome}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Banco</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${pixBanco}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Valor</td>
            <td style="padding:8px 0;font-size:16px;color:#15803d;font-weight:800">${p.preco}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">Identificação</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${nomeNegocio} — AgendaOK</td>
          </tr>
        </table>
      </div>

      <!-- Aviso -->
      <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:24px">
        <p style="margin:0;font-size:13px;color:#92400e;font-weight:600">
          ⏰ Após o pagamento, envie o comprovante para <strong>${process.env.EMAIL_USER || 'contato@agendaok.com'}</strong> e ativaremos seu plano em até 24h. Seu período grátis de 14 dias já está ativo!
        </p>
      </div>

      <p style="font-size:13px;color:#94a3b8;text-align:center;margin:0">
        Dúvidas? Responda este e-mail.<br/>
        © 2025 AgendaOK
      </p>
    </div>
  </div>
</body></html>`;

  try {
    await t.sendMail({
      from: `"AgendaOK" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `💳 Instruções de pagamento — Plano ${p.nome} AgendaOK`,
      html,
    });
    console.log(`✅ Pagamento enviado para ${email}`);
    return true;
  } catch(e) {
    console.error('❌ Erro pagamento:', e.message);
    return false;
  }
}

// ── 3. Confirmação de agendamento (pelo negócio) ─────────────

async function enviarConfirmacao({ nomeCliente, emailCliente, nomeNegocio, nicho, data, horario, servico, corNegocio, emailNegocio, senhaEmailNegocio }) {
  // Tenta usar o e-mail do negócio, senão usa o principal
  const t = criarTransporterNegocio(emailNegocio, senhaEmailNegocio) || criarTransporterPrincipal();
  if (!t) { console.log('⚠️  Nenhum e-mail configurado. Pulando confirmação.'); return false; }

  const [ano, mes, dia] = data.split('-');
  const dataFmt = `${dia}/${mes}/${ano}`;
  const cor = corNegocio || '#0d9488';
  const remetente = emailNegocio || process.env.EMAIL_USER;

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

  try {
    await t.sendMail({
      from: `"${nomeNegocio}" <${remetente}>`,
      to: emailCliente,
      subject: `✅ Agendamento confirmado — ${nomeNegocio} • ${dataFmt} às ${horario}`,
      html,
    });
    console.log(`✅ Confirmação enviada para ${emailCliente}`);
    return true;
  } catch(e) {
    console.error('❌ Erro confirmação:', e.message);
    return false;
  }
}

module.exports = { enviarBoasVindas, enviarInstrucoesPagamento, enviarConfirmacao };
