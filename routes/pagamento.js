const express = require('express');
const router  = express.Router();
const { MercadoPagoConfig, Preference, Payment, PreApproval } = require('mercadopago');
const { pool } = require('../middleware/database');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');

// ─── Configuração MP ─────────────────────────────────────────────────────────
function getMPClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurado no servidor.');
  return new MercadoPagoConfig({ accessToken: token });
}

function baseUrl() {
  return process.env.APP_URL || 'https://agendamento-production-e1a3.up.railway.app';
}

// ─── POST /pagamento/assinar ──────────────────────────────────────────────────
// Cria uma Preference (Checkout Pro) que aceita PIX, débito e crédito
router.post('/assinar', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query(
      'SELECT * FROM usuarios WHERE id=$1', [req.session.userId]
    )).rows[0];
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const client = new Preference(getMPClient());
    const base   = baseUrl();

    const preference = await client.create({
      body: {
        items: [{
          id:          'agendaok-pro-mensal',
          title:       'AgendaOK Pro — Acesso mensal',
          description: 'Acesso completo à plataforma AgendaOK por 30 dias',
          quantity:    1,
          currency_id: 'BRL',
          unit_price:  69.90,
        }],
        payer: {
          email: u.email,
          name:  u.nome || '',
        },
        payment_methods: {
          // Aceitar todos: crédito, débito e PIX
          excluded_payment_types: [],
          installments: 12, // até 12x no crédito
        },
        back_urls: {
          success: `${base}/pagamento/sucesso`,
          failure: `${base}/assinar?motivo=falha`,
          pending: `${base}/assinar?motivo=pendente`,
        },
        auto_return:         'approved',
        notification_url:    `${base}/pagamento/webhook`,
        external_reference:  u.id, // ID do usuário para identificar no webhook
        statement_descriptor:'AGENDAOK',
        expires:             false,
      }
    });

    res.json({ sucesso: true, checkout_url: preference.init_point });
  } catch(e) {
    console.error('Erro ao criar preferência MP:', e.message);
    res.status(500).json({ erro: e.message || 'Erro ao criar pagamento.' });
  }
});

// ─── GET /pagamento/sucesso ───────────────────────────────────────────────────
// MP redireciona aqui após pagamento aprovado
router.get('/sucesso', requireAuth, async (req, res) => {
  try {
    const { payment_id, status, external_reference } = req.query;

    if (status === 'approved' && payment_id) {
      // Verificar o pagamento na API do MP
      const client  = getMPClient();
      const payApi  = new Payment(client);
      const pay     = await payApi.get({ id: payment_id }).catch(() => null);

      // Usa o external_reference VERIFICADO na API do MP (não o da URL, que é manipulável)
      const userId = (pay && pay.external_reference) || req.session.userId;

      if (pay && pay.status === 'approved') {
        // Liberar 30 dias de acesso
        const expira = new Date();
        expira.setDate(expira.getDate() + 30);
        const expiraStr = expira.toISOString().split('T')[0];

        await pool.query(
          'UPDATE usuarios SET plano_pago=true, acesso_ativo=true, acesso_expira=$1 WHERE id=$2',
          [expiraStr, userId]
        );

        // Notificação no sino
        await pool.query(
          `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
           VALUES (gen_random_uuid(), $1,'pagamento','✅ Pagamento aprovado!','Seu acesso AgendaOK foi liberado por 30 dias. Obrigado!')`,
          [userId]
        ).catch(() => {});
      }
    }

    // Redireciona para o painel com mensagem de sucesso
    res.redirect('/painel?pagamento=aprovado');
  } catch(e) {
    console.error('Erro no retorno MP:', e.message);
    res.redirect('/painel');
  }
});

// ─── POST /pagamento/webhook ──────────────────────────────────────────────────
// Notificações automáticas do Mercado Pago
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  res.sendStatus(200); // Responde 200 imediatamente

  try {
    let body;
    try {
      body = JSON.parse(req.body.toString());
    } catch(e) { return; }

    const { type, data } = body;
    if (!data?.id) return;

    const client = getMPClient();
    const payApi = new Payment(client);

    // Pagamento aprovado
    if (type === 'payment') {
      const pay = await payApi.get({ id: data.id }).catch(() => null);
      if (!pay || pay.status !== 'approved') return;

      // Identificar usuário pelo external_reference ou email
      const userId = pay.external_reference;
      const email  = pay.payer?.email;

      let u = null;
      if (userId) {
        u = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [userId])).rows[0];
      }
      if (!u && email) {
        u = (await pool.query('SELECT * FROM usuarios WHERE email=$1', [email])).rows[0];
      }
      if (!u) return;

      const expira = new Date();
      expira.setDate(expira.getDate() + 30);
      const expiraStr = expira.toISOString().split('T')[0];

      await pool.query(
        'UPDATE usuarios SET plano_pago=true, acesso_ativo=true, acesso_expira=$1 WHERE id=$2',
        [expiraStr, u.id]
      );

      await pool.query(
        `INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
         VALUES (gen_random_uuid(), $1,'pagamento','✅ Pagamento aprovado!','Seu acesso foi liberado por 30 dias!')`,
        [u.id]
      ).catch(() => {});
    }

    // Assinatura recorrente (caso use PreApproval no futuro)
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      const preApi = new PreApproval(client);
      const sub    = await preApi.get({ id: data.id }).catch(() => null);
      if (!sub) return;

      const u = (await pool.query(
        'SELECT * FROM usuarios WHERE mp_subscription_id=$1', [data.id]
      )).rows[0];
      if (!u) return;

      if (sub.status === 'authorized') {
        const expira = new Date();
        expira.setDate(expira.getDate() + 30);
        await pool.query(
          'UPDATE usuarios SET plano_pago=true, acesso_ativo=true, acesso_expira=$1 WHERE id=$2',
          [expira.toISOString().split('T')[0], u.id]
        );
      }
    }
  } catch(e) {
    console.error('Webhook MP erro:', e.message);
  }
});

// ─── GET /pagamento/status ────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const u = (await pool.query(
      'SELECT * FROM usuarios WHERE id=$1', [req.session.userId]
    )).rows[0];
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

    res.json({ status_acesso, trial_expira: u.trial_expira,
               acesso_expira: u.acesso_expira, plano_pago: u.plano_pago });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ─── POST /pagamento/cancelar ─────────────────────────────────────────────────
router.post('/cancelar', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE usuarios SET plano_pago=false WHERE id=$1', [req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
