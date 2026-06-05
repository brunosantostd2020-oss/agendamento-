const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id UUID PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        nome_negocio TEXT NOT NULL,
        nicho TEXT NOT NULL,
        plano TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        ativo BOOLEAN DEFAULT true,
        criado_em TEXT,
        config JSONB DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS agendamentos (
        id UUID PRIMARY KEY,
        negocio_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        negocio_slug TEXT,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        telefone TEXT NOT NULL,
        servico TEXT DEFAULT '',
        obs TEXT DEFAULT '',
        data TEXT NOT NULL,
        horario TEXT NOT NULL,
        status TEXT DEFAULT 'pendente',
        criado_em TEXT,
        atualizado_em TEXT
      );

      CREATE TABLE IF NOT EXISTS horarios_bloqueados (
        id UUID PRIMARY KEY,
        negocio_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        horario TEXT NOT NULL,
        motivo TEXT DEFAULT '',
        criado_em TEXT
      );
    `);
    console.log('✅ Banco de dados iniciado com sucesso!');
  } catch(e) {
    console.error('❌ Erro ao iniciar banco:', e.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };

async function initServicos() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS servicos (
        id UUID PRIMARY KEY,
        negocio_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        preco NUMERIC(10,2),
        duracao INTEGER DEFAULT 60,
        descricao TEXT DEFAULT '',
        ativo BOOLEAN DEFAULT true,
        ordem INTEGER DEFAULT 0,
        criado_em TEXT
      );
    `);
    console.log('✅ Tabela serviços criada!');
  } catch(e) {
    console.error('❌ Erro serviços:', e.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, initServicos };

async function initColunas() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS servico_id UUID;
      ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS preco_servico NUMERIC(10,2);
      ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS servico_nome TEXT DEFAULT '';
    `);
    console.log('✅ Colunas extras OK!');
  } catch(e) { console.error('Colunas:', e.message); }
  finally { client.release(); }
}

module.exports = { pool, initDb, initServicos, initColunas };
