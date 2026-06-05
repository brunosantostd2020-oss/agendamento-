require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'agendaok-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// Rotas
app.use('/auth',    require('./routes/auth'));
app.use('/negocio', require('./routes/negocio'));
app.use('/p',       require('./routes/publico'));

// Páginas HTML
app.get('/cadastro',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/login',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/painel',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'painel.html')));
app.get('/agendar/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'agendar.html')));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n✅ AgendaOK rodando na porta ${PORT}`);
  console.log(`   Site:    http://localhost:${PORT}`);
  console.log(`   Painel:  http://localhost:${PORT}/painel\n`);
});
