// ── Conta de demonstração pública ────────────────────────────────────────────
// Cria (uma única vez) o negócio "Barbearia Demonstração" com slug 'demo',
// usado pelo botão "Ver demonstração" da landing page.
// Visitantes podem agendar à vontade — um job diário apaga os testes.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./database');

const DEMO_SLUG = 'demo';

async function initDemo() {
  const existe = await pool.query('SELECT id FROM usuarios WHERE slug=$1', [DEMO_SLUG]);
  if (existe.rows.length) { console.log('✅ Conta demo já existe'); return; }

  const id    = uuidv4();
  const agora = new Date().toLocaleString('pt-BR');
  // Senha aleatória forte — ninguém precisa (nem deve) logar nessa conta
  const senha = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 6);

  const config = {
    horarios: '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00,17:00,18:00',
    dias_uteis: '0,1,2,3,4,5,6',
    telefone: '',
    descricao: '✨ Esta é uma página de DEMONSTRAÇÃO do AgendaOK. Faça um agendamento de teste e veja como seus clientes vão agendar com você!',
    cor: '#0d9488',
    email_negocio: '', email_senha: '',
  };

  await pool.query(
    `INSERT INTO usuarios (id, nome, email, senha, nome_negocio, nicho, plano, slug, ativo, criado_em, config, trial_expira, acesso_ativo, plano_pago, acesso_expira)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,true,false,'')`,
    [id, 'Demonstração AgendaOK', 'demo@agendaok.online', senha,
     'Barbearia Demonstração', 'barbearia', 'trial', DEMO_SLUG, agora,
     JSON.stringify(config), '2099-12-31']
  );

  const servicos = [
    ['Corte de cabelo',    40, 30, 'Corte na tesoura ou máquina'],
    ['Barba completa',     30, 30, 'Toalha quente + navalha'],
    ['Corte + Barba',      60, 60, 'O combo mais pedido'],
    ['Sobrancelha',        15, 15, ''],
  ];
  for (let i = 0; i < servicos.length; i++) {
    const [nome, preco, dur, desc] = servicos[i];
    await pool.query(
      `INSERT INTO servicos (id, negocio_id, nome, preco, duracao, descricao, ativo, ordem, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8)`,
      [uuidv4(), id, nome, preco, dur, desc, i, agora]
    );
  }

  console.log(`✅ Conta demo criada — página pública em /agendar/${DEMO_SLUG}`);
}

// Apaga os agendamentos de teste da demo (roda 1x por dia)
async function limparDemo() {
  try {
    const r = await pool.query(
      `DELETE FROM agendamentos WHERE negocio_id IN (SELECT id FROM usuarios WHERE slug=$1)`,
      [DEMO_SLUG]
    );
    if (r.rowCount) console.log(`🧹 Demo: ${r.rowCount} agendamento(s) de teste apagado(s)`);
  } catch(e) { console.error('Limpeza demo:', e.message); }
}

module.exports = { initDemo, limparDemo, DEMO_SLUG };
