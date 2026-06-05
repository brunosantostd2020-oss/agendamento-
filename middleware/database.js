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

async function initExtras() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Avaliações
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id UUID PRIMARY KEY,
        negocio_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        agendamento_id UUID,
        nome_cliente TEXT,
        nota INTEGER CHECK (nota BETWEEN 1 AND 5),
        comentario TEXT DEFAULT '',
        criado_em TEXT
      );

      -- Lista de espera
      CREATE TABLE IF NOT EXISTS lista_espera (
        id UUID PRIMARY KEY,
        negocio_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        telefone TEXT NOT NULL,
        data TEXT NOT NULL,
        horario TEXT,
        notificado BOOLEAN DEFAULT false,
        criado_em TEXT
      );

      -- Fotos do negócio (URL)
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url TEXT DEFAULT '';
      
      -- Token de cancelamento nos agendamentos
      ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS token_cancel TEXT DEFAULT '';
      
      -- Token de avaliação
      ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS token_avalia TEXT DEFAULT '';
      ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS avaliado BOOLEAN DEFAULT false;
    `);
    console.log('✅ Tabelas extras OK!');
  } catch(e) {
    console.error('Extras:', e.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, initServicos, initColunas, initExtras };

async function initTrial() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_expira TEXT DEFAULT '';
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS acesso_ativo BOOLEAN DEFAULT true;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plano_pago BOOLEAN DEFAULT false;
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS acesso_expira TEXT DEFAULT '';
    `);
    // Preenche trial_expira para quem não tem
    await client.query(`
      UPDATE usuarios
      SET trial_expira = to_char(NOW() + INTERVAL '7 days', 'YYYY-MM-DD')
      WHERE trial_expira = '' OR trial_expira IS NULL
    `);
    console.log('✅ Colunas trial OK!');
  } catch(e) {
    console.error('Trial:', e.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, initServicos, initColunas, initExtras, initTrial };
