const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE  = path.join(DATA_DIR, 'db.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function lerDb() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return criarDbVazio();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch(e) { return criarDbVazio(); }
}

function criarDbVazio() {
  const db = { usuarios: [], agendamentos: [], horarios_bloqueados: [] };
  salvarDb(db);
  return db;
}

function salvarDb(db) {
  ensureDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

module.exports = { lerDb, salvarDb };
