require('dotenv').config();
const express   = require('express');
const session   = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors      = require('cors');
const path      = require('path');
const { pool, initDb, initServicos, initColunas, initExtras, initTrial, initTokenConfirm } = require('./middleware/database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'agendaok-secret-2024',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

app.use('/auth',     require('./routes/auth'));
app.use('/negocio',  require('./routes/negocio'));
app.use('/servicos', require('./routes/servicos'));
app.use('/p',        require('./routes/publico'));
app.use('/extras',   require('./routes/extras'));
app.use('/admin',    require('./routes/admin'));

app.get('/cadastro',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/login',             (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/recuperar-senha',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/painel',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/agendar/:slug',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'agendar.html')));
app.get('/cancelar/:token',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'cancelar.html')));
app.get('/avaliar/:token',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'avaliar.html')));
app.get('/confirmar/:token',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'confirmar.html')));
app.get('/historico/:slug',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'historico.html')));
app.get('/master',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));
app.get('*',                  (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb()
  .then(() => initServicos())
  .then(() => initColunas())
  .then(() => initExtras())
  .then(() => initTrial())
  .then(() => initTokenConfirm())
  .then(() => {
    app.listen(PORT, () => console.log(`✅ AgendaOK rodando na porta ${PORT}`));
  });
