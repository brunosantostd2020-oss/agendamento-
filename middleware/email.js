const nodemailer = require('nodemailer');

function criarTransporter() {
  // Se tiver configuração SMTP no .env, usa ela
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Padrão: Gmail
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // senha de app do Gmail
    },
  });
}

async function enviarConfirmacao({ nomeCliente, emailCliente, nomeNegocio, nicho, data, horario, servico, corNegocio }) {
  if (!process.env.EMAIL_USER && !process.env.SMTP_HOST) {
    console.log('⚠️  E-mail não configurado. Pulando envio.');
    return false;
  }

  const [ano, mes, dia] = data.split('-');
  const dataFmt = `${dia}/${mes}/${ano}`;
  const cor = corNegocio || '#0d9488';

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Confirmação de Agendamento</title></head>
<body style="margin:0;padding:0;background:#f0f9ff;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    
    <!-- Header -->
    <div style="background:${cor};padding:32px;text-align:center">
      <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:12px;padding:8px 20px;margin-bottom:12px">
        <span style="color:white;font-size:13px;font-weight:700;letter-spacing:0.08em">AGENDA OK</span>
      </div>
      <h1 style="color:white;margin:0;font-size:26px;font-weight:800">✅ Agendamento Confirmado!</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:15px">Seu horário está reservado</p>
    </div>

    <!-- Body -->
    <div style="padding:32px">
      <p style="font-size:16px;color:#334155;margin:0 0 24px">
        Olá, <strong>${nomeCliente}</strong>! 👋<br/>
        Seu agendamento em <strong>${nomeNegocio}</strong> foi realizado com sucesso.
      </p>

      <!-- Card do agendamento -->
      <div style="background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:24px">
        <h2 style="margin:0 0 16px;font-size:16px;color:#15803d;text-transform:uppercase;letter-spacing:0.06em">Detalhes do agendamento</h2>
        
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600;width:40%">📅 Data</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${dataFmt}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">🕐 Horário</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${horario}</td>
          </tr>
          <tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">🏢 Local</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${nomeNegocio}</td>
          </tr>
          ${servico ? `<tr style="border-top:1px solid #dcfce7">
            <td style="padding:8px 0;font-size:14px;color:#64748b;font-weight:600">✂️ Serviço</td>
            <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:700">${servico}</td>
          </tr>` : ''}
        </table>
      </div>

      <!-- Aviso -->
      <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:24px">
        <p style="margin:0;font-size:13px;color:#92400e;font-weight:600">
          ⏰ Lembre-se de chegar com alguns minutos de antecedência. Em caso de imprevistos, entre em contato com o estabelecimento.
        </p>
      </div>

      <p style="font-size:14px;color:#64748b;text-align:center;margin:0">
        Este e-mail foi gerado automaticamente pela plataforma <strong style="color:${cor}">AgendaOK</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:12px;color:#94a3b8">
        © 2025 AgendaOK — Plataforma de Agendamento Online
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    const transporter = criarTransporter();
    await transporter.sendMail({
      from: `"${nomeNegocio} via AgendaOK" <${process.env.EMAIL_USER || process.env.SMTP_USER}>`,
      to: emailCliente,
      subject: `✅ Agendamento confirmado — ${nomeNegocio} • ${dataFmt} às ${horario}`,
      html,
    });
    console.log(`✅ E-mail enviado para ${emailCliente}`);
    return true;
  } catch(e) {
    console.error('❌ Erro ao enviar e-mail:', e.message);
    return false;
  }
}

module.exports = { enviarConfirmacao };
