require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const pgSession  = require('connect-pg-simple')(session);
const cors       = require('cors');
const path       = require('path');
const { pool, initDb } = require('./middleware/database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessão salva no PostgreSQL
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'agendaok-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

// Rotas
app.use('/auth',    require('./routes/auth'));
app.use('/negocio', require('./routes/negocio'));
app.use('/p',       require('./routes/publico'));

// Páginas
app.get('/cadastro',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/login',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/painel',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/agendar/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'agendar.html')));
app.get('*',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Inicia banco e servidor
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ AgendaOK rodando na porta ${PORT}`);
  });
});
