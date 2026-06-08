const express = require('express');
const router  = express.Router();
const { MercadoPagoConfig, PreApproval, Payment } = require('mercadopago');
const { pool } = require('../middleware/database');
const { requireAuth } = require('../middleware/auth');

// ─── Configuração MP ────────────────────────────────────────────────────────
function getMPClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurado.');
  return new MercadoPagoConfig({ accessToken: token });
}

// ─── POST /pagamento/assinar ────────────────────────────────────────────────
// Cria uma assinatura recorrente de R$69,90/mês
router.post('/assinar', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [req.session.userId])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const client = getMPClient();
    const preApproval = new PreApproval(client);

    const backUrl = process.env.APP_URL || 'https://agendamento-production-e1a3.up.railway.app';

    const data = await preApproval.create({
      body: {
        payer_email:   u.email,
        back_url:      `${backUrl}/painel`,
        reason:        'AgendaOK — Assinatura Mensal',
        auto_recurring: {
          frequency:           1,
          frequency_type:      'months',
          transaction_amount:  69.90,
          currency_id:         'BRL',
        },
        status: 'pending',
      }
    });

    // Salva o ID da assinatura no banco
    await pool.query(
      'UPDATE usuarios SET mp_subscription_id=$1 WHERE id=$2',
      [data.id, u.id]
    ).catch(() => {});

    // Retorna URL de pagamento
    res.json({ sucesso: true, checkout_url: data.init_point });
  } catch(e) {
    console.error('Erro ao criar assinatura MP:', e.message);
    res.status(500).json({ erro: 'Erro ao criar assinatura. Tente novamente.' });
  }
});

// ─── GET /pagamento/status ──────────────────────────────────────────────────
// Verifica status atual da assinatura do usuário logado
router.get('/status', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [req.session.userId])).rows[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const hoje = new Date().toISOString().split('T')[0];
    let status_acesso;

    if (u.plano_pago && u.acesso_expira && u.acesso_expira >= hoje) {
      status_acesso = 'pago';
    } else if (!u.plano_pago && u.trial_expira && u.trial_expira >= hoje) {
      status_acesso = 'trial';
    } else if (u.acesso_ativo === false) {
      status_acesso = 'bloqueado';
    } else {
      status_acesso = 'expirado';
    }

    res.json({
      status_acesso,
      trial_expira:   u.trial_expira,
      acesso_expira:  u.acesso_expira,
      plano_pago:     u.plano_pago,
      acesso_ativo:   u.acesso_ativo,
    });
  } catch(e) {
    res.status(500).json({ erro: e.message });
  }
});

// ─── POST /pagamento/webhook ────────────────────────────────────────────────
// Webhook do Mercado Pago — atualiza status automaticamente
router.post('/webhook', express.json(), async (req, res) => {
  // Responde 200 imediatamente para o MP
  res.sendStatus(200);

  try {
    const { type, data } = req.body;

    // Assinatura (preapproval)
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      const subId = data?.id;
      if (!subId) return;

      const client = getMPClient();
      const preApproval = new PreApproval(client);
      const sub = await preApproval.get({ id: subId });

      const u = (await pool.query(
        'SELECT * FROM usuarios WHERE mp_subscription_id=$1', [subId]
      )).rows[0];
      if (!u) return;

      if (sub.status === 'authorized') {
        // Calcula 30 dias de acesso a partir de hoje
        const expira = new Date();
        expira.setDate(expira.getDate() + 30);
        const expiraStr = expira.toISOString().split('T')[0];

        await pool.query(
          'UPDATE usuarios SET plano_pago=true, acesso_ativo=true, acesso_expira=$1 WHERE id=$2',
          [expiraStr, u.id]
        );

        // Notificação de sucesso
        await pool.query(
          `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem) VALUES ($1,'pagamento','Pagamento aprovado!','Sua assinatura AgendaOK foi ativada com sucesso. Acesso liberado por 30 dias.')`,
          [u.id]
        ).catch(() => {});

      } else if (['cancelled', 'paused', 'pending'].includes(sub.status)) {
        // Não bloqueia imediatamente — só marca plano_pago=false
        await pool.query(
          'UPDATE usuarios SET plano_pago=false WHERE id=$1', [u.id]
        );

        if (sub.status === 'cancelled') {
          await pool.query(
            `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem) VALUES ($1,'aviso','Assinatura cancelada','Sua assinatura foi cancelada. Assine novamente para continuar usando o AgendaOK.')`,
            [u.id]
          ).catch(() => {});
        }
      }
      return;
    }

    // Pagamento avulso (fallback)
    if (type === 'payment') {
      const payId = data?.id;
      if (!payId) return;

      const client = getMPClient();
      const payment = new Payment(client);
      const pay = await payment.get({ id: payId });

      if (pay.status !== 'approved') return;

      // Tenta identificar o usuário pelo email
      const email = pay.payer?.email;
      if (!email) return;

      const u = (await pool.query('SELECT * FROM usuarios WHERE email=$1', [email])).rows[0];
      if (!u) return;

      const expira = new Date();
      expira.setDate(expira.getDate() + 30);
      const expiraStr = expira.toISOString().split('T')[0];

      await pool.query(
        'UPDATE usuarios SET plano_pago=true, acesso_ativo=true, acesso_expira=$1 WHERE id=$2',
        [expiraStr, u.id]
      );

      await pool.query(
        `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem) VALUES ($1,'pagamento','Pagamento aprovado!','Seu pagamento foi confirmado. Acesso liberado por 30 dias.')`,
        [u.id]
      ).catch(() => {});
    }
  } catch(e) {
    console.error('Erro webhook MP:', e.message);
  }
});

// ─── GET /pagamento/historico ───────────────────────────────────────────────
// Busca histórico de pagamentos do usuário (via MP)
router.get('/historico', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query('SELECT mp_subscription_id FROM usuarios WHERE id=$1', [req.session.userId])).rows[0];
    if (!u) return res.json({ pagamentos: [] });

    if (!u.mp_subscription_id) return res.json({ pagamentos: [] });

    const client = getMPClient();
    const preApproval = new PreApproval(client);
    const sub = await preApproval.get({ id: u.mp_subscription_id });

    res.json({
      pagamentos: [{
        id:          sub.id,
        status:      sub.status,
        valor:       sub.auto_recurring?.transaction_amount,
        moeda:       sub.auto_recurring?.currency_id,
        criado_em:   sub.date_created,
        atualizado:  sub.last_modified,
        proxima_data: sub.next_payment_date,
      }]
    });
  } catch(e) {
    res.json({ pagamentos: [] });
  }
});

// ─── POST /pagamento/cancelar ───────────────────────────────────────────────
router.post('/cancelar', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query('SELECT mp_subscription_id FROM usuarios WHERE id=$1', [req.session.userId])).rows[0];
    if (!u || !u.mp_subscription_id) return res.status(400).json({ erro: 'Nenhuma assinatura encontrada.' });

    const client = getMPClient();
    const preApproval = new PreApproval(client);
    await preApproval.update({ id: u.mp_subscription_id, body: { status: 'cancelled' } });

    await pool.query('UPDATE usuarios SET plano_pago=false WHERE id=$1', [u.id]);
    res.json({ sucesso: true });
  } catch(e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
