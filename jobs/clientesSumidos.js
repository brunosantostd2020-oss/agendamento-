// ── Alerta semanal: clientes sumidos ─────────────────────────────────────────
// Toda segunda-feira (9h BR), avisa cada negócio (sino + push) sobre clientes
// que concluíram atendimento mas não agendam entre 30 e 90 dias — hora de
// chamar de volta pelo WhatsApp. Transforma o AgendaOK em ferramenta de retorno.

const { pool } = require('../middleware/database');
const { enviarPushUsuario } = require('../middleware/push');

async function rodarClientesSumidos() {
  // Só roda na segunda-feira (horário de Brasília)
  const agoraBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
  if (agoraBR.getUTCDay() !== 1) return;

  const hoje    = agoraBR.toISOString().split('T')[0];
  const d30     = new Date(agoraBR); d30.setUTCDate(d30.getUTCDate() - 30);
  const d90     = new Date(agoraBR); d90.setUTCDate(d90.getUTCDate() - 90);
  const corte30 = d30.toISOString().split('T')[0];
  const corte90 = d90.toISOString().split('T')[0];

  console.log('🔁 Clientes sumidos: verificando...');

  try {
    // Por negócio: clientes (agrupados por telefone) cuja ÚLTIMA visita concluída
    // foi entre 90 e 30 dias atrás e que não têm nada agendado pra frente
    const { rows } = await pool.query(`
      WITH ultima AS (
        SELECT negocio_id, telefone,
               MAX(nome)  AS nome,
               MAX(data)  AS ultima_visita
        FROM agendamentos
        WHERE status = 'concluido' AND telefone <> ''
        GROUP BY negocio_id, telefone
      ),
      futuros AS (
        SELECT DISTINCT negocio_id, telefone
        FROM agendamentos
        WHERE data >= $1 AND status IN ('pendente','confirmado')
      )
      SELECT u.negocio_id, u.telefone, u.nome, u.ultima_visita
      FROM ultima u
      LEFT JOIN futuros f
        ON f.negocio_id = u.negocio_id AND f.telefone = u.telefone
      WHERE f.telefone IS NULL
        AND u.ultima_visita <= $2
        AND u.ultima_visita >= $3
      ORDER BY u.negocio_id, u.ultima_visita ASC
    `, [hoje, corte30, corte90]);

    // Agrupar por negócio (máx. 5 clientes por aviso pra não virar spam)
    const porNegocio = new Map();
    for (const r of rows) {
      if (!porNegocio.has(r.negocio_id)) porNegocio.set(r.negocio_id, []);
      const lista = porNegocio.get(r.negocio_id);
      if (lista.length < 5) lista.push(r);
    }

    let avisados = 0;
    for (const [negocioId, clientes] of porNegocio) {
      const qtd    = clientes.length;
      const titulo = `🔁 ${qtd} cliente${qtd > 1 ? 's' : ''} sem agendar há mais de 30 dias`;
      const linhas = clientes.map(c => {
        const tel  = c.telefone.replace(/\D/g, '');
        const wa   = tel.length >= 10 ? ` — wa.me/${tel.length <= 11 ? '55' + tel : tel}` : '';
        const data = (c.ultima_visita || '').split('-').reverse().join('/');
        return `${c.nome} (última visita: ${data})${wa}`;
      });
      const msg = 'Chame de volta pelo WhatsApp: ' + linhas.join(' · ');

      // Sino do painel (anti-duplicata: 1 aviso por semana)
      await pool.query(`
        INSERT INTO notificacoes (id, usuario_id, tipo, titulo, mensagem)
        SELECT gen_random_uuid(), $1, 'aviso', $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM notificacoes
          WHERE usuario_id = $1
            AND titulo LIKE '🔁%'
            AND criado_em > NOW() - INTERVAL '6 days'
        )
      `, [negocioId, titulo, msg]).catch(() => {});

      // Push (se o dono ativou notificações)
      enviarPushUsuario(negocioId, {
        titulo,
        corpo: `${clientes.map(c => c.nome).join(', ')} — abra o painel e chame de volta 👋`,
        url: '/painel',
      }).catch(() => {});

      avisados++;
    }

    console.log(`🔁 Clientes sumidos: ${avisados} negócio(s) avisado(s)`);
  } catch(e) {
    console.error('❌ Erro clientes sumidos:', e.message);
  }
}

module.exports = { rodarClientesSumidos };
