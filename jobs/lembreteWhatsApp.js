/**
 * Job: Lembrete WhatsApp 1h antes
 * Roda a cada 15 minutos
 * Detecta agendamentos que acontecem em ~1h e dispara notificação no sino
 * (o dono recebe a notificação e pode enviar o WhatsApp com 1 clique)
 */
const { pool } = require('../middleware/database');
const { v4: uuidv4 } = require('uuid');

async function rodarLembreteWhatsApp() {
  try {
    const agoraBR = new Date(Date.now() - 3*60*60*1000);
    const hojeStr = agoraBR.toISOString().split('T')[0];
    const hAtual  = agoraBR.getUTCHours();
    const mAtual  = agoraBR.getUTCMinutes();
    const minAgora = hAtual * 60 + mAtual;

    // Buscar agendamentos de hoje pendentes ou confirmados
    const { rows } = await pool.query(`
      SELECT a.id, a.nome, a.telefone, a.horario, a.servico,
             a.negocio_id, u.nome_negocio, u.slug, u.config
      FROM agendamentos a
      JOIN usuarios u ON u.id = a.negocio_id
      WHERE a.data = $1
        AND a.status IN ('pendente','confirmado')
        AND a.telefone IS NOT NULL AND a.telefone != ''
    `, [hojeStr]);

    for (const ag of rows) {
      const [hh, mm] = (ag.horario||'00:00').split(':').map(Number);
      const minAg = hh * 60 + (mm||0);
      const diff  = minAg - minAgora;

      // Entre 55 e 70 minutos de antecedência
      if (diff >= 55 && diff <= 70) {
        const titulo  = `📱 Lembrete: ${ag.nome} às ${ag.horario}`;
        const msg     = `Agendamento em ~1h! Envie um lembrete pelo WhatsApp para ${ag.nome} (${ag.horario}${ag.servico ? ' · ' + ag.servico : ''}).`;

        // Inserir notificação no sino (anti-duplicata)
        await pool.query(`
          INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
          SELECT gen_random_uuid(), $1, 'aviso', $2, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM notificacoes
            WHERE usuario_id = $1
              AND titulo = $2
              AND criado_em > NOW() - INTERVAL '2 hours'
          )
        `, [ag.negocio_id, titulo, msg]).catch(() => {});

        console.log(`📱 Lembrete sino: ${ag.nome} às ${ag.horario} (${diff}min)`);
      }
    }
  } catch(e) {
    console.error('❌ Erro lembrete WhatsApp:', e.message);
  }
}

module.exports = { rodarLembreteWhatsApp };
