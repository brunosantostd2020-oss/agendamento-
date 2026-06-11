// ── Mailer central do AgendaOK ───────────────────────────────────────────────
// Prioridade: Resend (RESEND_API_KEY) → Gmail via nodemailer (fallback).
//
// Variáveis de ambiente:
//   RESEND_API_KEY  — chave da conta resend.com (recomendado)
//   EMAIL_FROM      — remetente verificado no Resend (ex: contato@seudominio.com).
//                     Sem domínio próprio, use o padrão onboarding@resend.dev
//   EMAIL_USER/EMAIL_PASS — conta Gmail (fallback, modo antigo)

const nodemailer = require('nodemailer');

async function enviarEmail({ fromName = 'AgendaOK', to, subject, html, gmailUser, gmailPass }) {
  if (!to) return false;

  // 1) Resend (recomendado)
  if (process.env.RESEND_API_KEY) {
    const from = `${fromName} <${process.env.EMAIL_FROM || 'onboarding@resend.dev'}>`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`Resend ${r.status}: ${txt.slice(0, 200)}`);
      }
      console.log(`✅ E-mail (Resend) → ${to}`);
      return true;
    } catch(e) {
      console.error('❌ Resend falhou:', e.message);
      // continua para o fallback Gmail abaixo, se configurado
    }
  }

  // 2) Fallback: Gmail via nodemailer (conta do negócio ou a principal)
  const user = gmailUser || process.env.EMAIL_USER;
  const pass = gmailPass || process.env.EMAIL_PASS;
  if (!user || !pass) {
    console.log('⚠️  Nenhum provedor de e-mail configurado (RESEND_API_KEY ou EMAIL_USER/EMAIL_PASS).');
    return false;
  }
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await t.sendMail({ from: `"${fromName}" <${user}>`, to, subject, html });
    console.log(`✅ E-mail (Gmail) → ${to}`);
    return true;
  } catch(e) {
    console.error('❌ Gmail falhou:', e.message);
    return false;
  }
}

module.exports = { enviarEmail };
