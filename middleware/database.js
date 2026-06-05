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
