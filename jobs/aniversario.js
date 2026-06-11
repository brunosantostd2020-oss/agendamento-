/**
 * Job: Aniversário de clientes
 * Roda uma vez por dia às 8h BR
 * Notifica no sino quando um cliente faz aniversário hoje
 */
const { pool } = require('../middleware/database');
const { v4: uuidv4 } = require('uuid');

async function rodarAniversarios() {
  try {
    const agoraBR = new Date(Date.now() - 3*60*60*1000);
    const hoje    = agoraBR.toISOString().split('T')[0]; // YYYY-MM-DD
    const mesDia  = hoje.slice(5); // MM-DD

    // Buscar clientes cadastrados manualmente com data de nascimento hoje
    const { rows } = await pool.query(`
      SELECT DISTINCT
        a.nome, a.telefone, a.negocio_id,
        u.nome_negocio
      FROM agendamentos a
      JOIN usuarios u ON u.id = a.negocio_id
      WHERE a.obs LIKE '%nasc:%'
        AND SUBSTRING(a.obs FROM 'nasc:([0-9]{4}-[0-9]{2}-[0-9]{2})') IS NOT NULL
        AND SUBSTRING(
          SUBSTRING(a.obs FROM 'nasc:([0-9]{4}-[0-9]{2}-[0-9]{2})'),
          6
        ) = $1
        AND a.telefone IS NOT NULL AND a.telefone != ''
    `, [mesDia]);

    for (const c of rows) {
      const titulo = `🎂 Aniversário: ${c.nome}!`;
      const msg    = `Hoje é aniversário de ${c.nome}! Envie uma mensagem especial pelo WhatsApp e ofereça um desconto.`;

      await pool.query(`
        INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
        SELECT gen_random_uuid(), $1, 'pagamento', $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM notificacoes
          WHERE usuario_id = $1 AND titulo = $2
            AND criado_em::date = CURRENT_DATE
        )
      `, [c.negocio_id, titulo, msg]).catch(() => {});

      console.log(`🎂 Aniversário detectado: ${c.nome} — ${c.nome_negocio}`);
    }
  } catch(e) {
    console.error('❌ Erro job aniversário:', e.message);
  }
}

module.exports = { rodarAniversarios };
