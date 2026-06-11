require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors      = require('cors');
const path      = require('path');
const { pool, initDb, initServicos, initColunas, initExtras, initTrial,
        initTokenConfirm, initPagamento, initFuncionarios } = require('./middleware/database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));

// Webhook MP — raw body ANTES do express.json()
app.use('/pagamento/webhook', express.raw({ type: '*/*' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessão com timeout e error handler
const sessionStore = new pgSession({
  pool,
  tableName: 'session',
  createTableIfMissing: true,
  errorLog: (e) => console.error('Session store error:', e.message),
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'agendaok-secret-2024',
  resave: false,
  saveUninitialized: false,
  rolling: false,          // não re-salva sessão a cada request (menos queries)
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   30 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

// Health check — responde ANTES de qualquer rota (Railway healthcheck)
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use('/auth',          require('./routes/auth'));
app.use('/negocio',       require('./routes/negocio'));
app.use('/servicos',      require('./routes/servicos'));
app.use('/p',             require('./routes/publico'));
app.use('/extras',        require('./routes/extras'));
app.use('/admin',         require('./routes/admin'));
app.use('/pagamento',     require('./routes/pagamento'));
app.use('/funcionarios',  require('./routes/funcionarios'));

app.get('/cadastro',         (_, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/login',            (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/painel',           (_, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/assinar',          (_, res) => res.sendFile(path.join(__dirname, 'public', 'assinar.html')));
// Sucesso MP é tratado pela rota /pagamento/sucesso no router
app.get('/agendar/:slug',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'agendar.html')));
app.get('/cancelar/:token',  (_, res) => res.sendFile(path.join(__dirname, 'public', 'cancelar.html')));
app.get('/avaliar/:token',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'avaliar.html')));
app.get('/confirmar/:token', (_, res) => res.sendFile(path.join(__dirname, 'public', 'confirmar.html')));
app.get('/historico/:slug',  (_, res) => res.sendFile(path.join(__dirname, 'public', 'historico.html')));
app.get('/master',           (_, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));
app.get('/reagendar',        (_, res) => res.sendFile(path.join(__dirname, 'public', 'reagendar.html')));
app.get('*',                 (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Inicializar banco e subir servidor ──────────────────────────────────────
// Sobe o servidor IMEDIATAMENTE (Railway vê a porta aberta)
// e roda as migrations em background com timeout
const server = app.listen(PORT, () => {
  console.log(`✅ AgendaOK rodando na porta ${PORT}`);
});

// Timeout de segurança: se as inits travarem, loga e continua
async function runInits() {
  const timeout = (ms, name) => new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${name} demorou mais de ${ms/1000}s`)), ms)
  );

  const safe = async (fn, name) => {
    try {
      await Promise.race([fn(), timeout(15000, name)]);
      console.log(`✅ ${name} OK`);
    } catch(e) {
      console.error(`⚠️  ${name} falhou (não crítico): ${e.message}`);
    }
  };

  await safe(initDb,           'initDb');
  await safe(initServicos,     'initServicos');
  await safe(initColunas,      'initColunas');
  await safe(initExtras,       'initExtras');
  await safe(initTrial,        'initTrial');
  await safe(initTokenConfirm, 'initTokenConfirm');
  await safe(initPagamento,    'initPagamento');
  await safe(initFuncionarios, 'initFuncionarios');
  console.log('✅ Todas as migrations concluídas');
}

runInits().catch(e => console.error('Erro nas migrations:', e.message));

// ── Job diário: aviso de vencimento (roda às 9h horário de Brasília) ──
const { rodarAvisoVencimento } = require('./jobs/avisoVencimento');

function agendarJobDiario() {
  const agora    = new Date();
  // Hora atual em Brasília (UTC-3)
  const agoraBR  = new Date(agora.getTime() - 3*60*60*1000);
  const hBR      = agoraBR.getUTCHours();
  const mBR      = agoraBR.getUTCMinutes();
  // Próximas 9h BR em UTC = 12h UTC
  const alvo     = new Date(agora);
  alvo.setUTCHours(12, 0, 0, 0);
  if (agora >= alvo) alvo.setUTCDate(alvo.getUTCDate() + 1);
  const msAte9h  = alvo - agora;
  console.log(`⏰ Job vencimento agendado para daqui ${Math.round(msAte9h/60000)} min`);
  setTimeout(() => {
    rodarAvisoVencimento();
    // Repetir a cada 24h
    setInterval(rodarAvisoVencimento, 24 * 60 * 60 * 1000);
  }, msAte9h);
}

agendarJobDiario();

// ── Job a cada hora: auto-concluir agendamentos que passaram ──
const { rodarAutoConcluir }      = require('./jobs/autoConcluir');
const { rodarLembreteWhatsApp }  = require('./jobs/lembreteWhatsApp');
const { rodarAniversarios }      = require('./jobs/aniversario');

// Auto-concluir: a cada 1 hora
setTimeout(() => {
  rodarAutoConcluir();
  setInterval(rodarAutoConcluir, 60 * 60 * 1000);
}, 5000);

// Lembrete WhatsApp 1h antes: a cada 15 minutos
setTimeout(() => {
  rodarLembreteWhatsApp();
  setInterval(rodarLembreteWhatsApp, 15 * 60 * 1000);
}, 10000);

// Aniversários: 1x por dia às 8h BR (11h UTC)
(function agendarAniversario() {
  const agora = new Date();
  const alvo  = new Date(agora);
  alvo.setUTCHours(11, 0, 0, 0);
  if (agora >= alvo) alvo.setUTCDate(alvo.getUTCDate() + 1);
  setTimeout(() => {
    rodarAniversarios();
    setInterval(rodarAniversarios, 24 * 60 * 60 * 1000);
  }, alvo - agora);
})();
