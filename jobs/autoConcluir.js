/**
 * Job: Auto-Concluir Agendamentos
 * Roda a cada hora
 * Conclui APENAS agendamentos do DIA DE HOJE que passaram 1h do horário
 */
const { pool } = require('../middleware/database');

async function rodarAutoConcluir() {
  try {
    // Data e hora atual em Brasília (UTC-3)
    const agoraBR       = new Date(Date.now() - 3*60*60*1000);
    const hojeStr       = agoraBR.toISOString().split('T')[0];
    const minTotalAgora = agoraBR.getUTCHours() * 60 + agoraBR.getUTCMinutes();

    // Buscar APENAS agendamentos de HOJE que ainda estão pendente ou confirmado
    const { rows } = await pool.query(`
      SELECT id, nome, data, horario, status
      FROM agendamentos
      WHERE status IN ('pendente', 'confirmado')
        AND data = $1
    `, [hojeStr]);

    let concluidos = 0;

    for (const ag of rows) {
      const [hh, mm]  = (ag.horario || '00:00').split(':').map(Number);
      const minAg     = hh * 60 + (mm || 0);
      const minPassados = minTotalAgora - minAg;

      // Só conclui se o horário já passou há pelo menos 60 minutos
      if (minPassados >= 60) {
        await pool.query(
          `UPDATE agendamentos
           SET status = 'concluido', atualizado_em = $1
           WHERE id = $2`,
          [new Date().toLocaleString('pt-BR'), ag.id]
        );
        concluidos++;
        console.log(`✅ Auto-concluído: ${ag.nome} às ${ag.horario} (passou ${minPassados}min)`);
      }
    }

    if (concluidos === 0 && rows.length > 0) {
      console.log(`⏳ Auto-concluir: ${rows.length} agendamento(s) hoje ainda no horário`);
    }

  } catch(e) {
    console.error('❌ Erro auto-concluir:', e.message);
  }
}

module.exports = { rodarAutoConcluir };
