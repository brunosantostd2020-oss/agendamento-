const { pool } = require('./database');

// Data de hoje no fuso de Brasília (UTC-3)
function hojeBR() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function minutos(h) {
  const [hh, mm] = (h || '0:0').split(':').map(Number);
  return hh * 60 + (mm || 0);
}

// Ocupações do dia com a duração real do serviço (quando conhecida).
// Agendamento sem serviço vinculado ocupa apenas o próprio slot (comportamento antigo).
async function buscarOcupacoes(negocioId, data, ignorarId) {
  const rows = (await pool.query(
    `SELECT a.id, a.horario, a.funcionario_id, s.duracao
     FROM agendamentos a
     LEFT JOIN servicos s ON s.id = a.servico_id
     WHERE a.negocio_id=$1 AND a.data=$2 AND a.status IN ('pendente','confirmado','reagendado')`,
    [negocioId, data]
  )).rows;
  return rows
    .filter(r => !ignorarId || r.id !== ignorarId)
    .map(r => {
      const ini = minutos(r.horario);
      const dur = parseInt(r.duracao) || 0;
      return { ini, fim: ini + Math.max(dur, 1), func: r.funcionario_id || null };
    });
}

async function contarProfissionais(negocioId) {
  return +(await pool.query(
    'SELECT COUNT(*) FROM funcionarios WHERE negocio_id=$1 AND ativo=true', [negocioId]
  )).rows[0].count;
}

// Conflito de um novo agendamento [ini, ini+dur):
// — Sem equipe: qualquer sobreposição bloqueia (1 atendimento por vez).
// — Com equipe: profissional escolhido ocupado bloqueia; senão bloqueia
//   apenas quando TODOS os profissionais estão ocupados (capacidade cheia).
function temConflito({ ini, dur, funcionarioId, ocupacoes, numProfs }) {
  const fim = ini + Math.max(parseInt(dur) || 0, 1);
  const sobrepostos = ocupacoes.filter(o => ini < o.fim && o.ini < fim);
  if (numProfs > 0) {
    if (funcionarioId && sobrepostos.some(o => o.func === funcionarioId)) return true;
    return sobrepostos.length >= numProfs;
  }
  return sobrepostos.length >= 1;
}

module.exports = { hojeBR, minutos, buscarOcupacoes, contarProfissionais, temConflito };
