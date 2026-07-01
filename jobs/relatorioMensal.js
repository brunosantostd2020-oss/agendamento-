// ── Relatório mensal por e-mail ──────────────────────────────────────────────
// Todo dia 1º (8h BR), cada negócio ativo recebe um resumo do mês anterior:
// total de agendamentos, faturamento, serviço mais pedido e cliente mais frequente.
// Lembra o assinante, todo mês, do valor que o AgendaOK entrega.

const { pool } = require('../middleware/database');
const { enviarEmail } = require('../middleware/mailer');

function mesAnteriorBR() {
  const agoraBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(agoraBR.getUTCFullYear(), agoraBR.getUTCMonth() - 1, 1));
  const prefixo = d.toISOString().slice(0, 7); // 'YYYY-MM'
  const nomes = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro'];
  return { prefixo, nome: `${nomes[d.getUTCMonth()]} de ${d.getUTCFullYear()}` };
}

const fmtReal = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

async function rodarRelatorioMensal() {
  // Só roda no dia 1º (horário de Brasília)
  const agoraBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
  if (agoraBR.getUTCDate() !== 1) return;

  const { prefixo, nome: nomeMes } = mesAnteriorBR();
  console.log(`📊 Relatório mensal: gerando resumos de ${nomeMes}...`);

  try {
    const negocios = (await pool.query(
      `SELECT id, nome, email, nome_negocio FROM usuarios
       WHERE ativo = true AND slug <> 'demo' AND email NOT LIKE '%@agendaok.online'`
    )).rows;

    let enviados = 0;
    for (const n of negocios) {
      try {
        const stats = (await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE status <> 'cancelado')                          AS total,
            COUNT(*) FILTER (WHERE status = 'concluido')                           AS concluidos,
            COUNT(*) FILTER (WHERE status = 'cancelado')                           AS cancelados,
            COALESCE(SUM(preco_servico) FILTER (WHERE status = 'concluido'), 0)    AS faturamento
          FROM agendamentos
          WHERE negocio_id = $1 AND data LIKE $2
        `, [n.id, prefixo + '-%'])).rows[0];

        if (parseInt(stats.total) === 0) continue; // mês sem movimento: não envia

        const topServico = (await pool.query(`
          SELECT servico, COUNT(*) AS qtd FROM agendamentos
          WHERE negocio_id = $1 AND data LIKE $2 AND status <> 'cancelado' AND servico <> ''
          GROUP BY servico ORDER BY qtd DESC LIMIT 1
        `, [n.id, prefixo + '-%'])).rows[0];

        const topCliente = (await pool.query(`
          SELECT nome, COUNT(*) AS qtd FROM agendamentos
          WHERE negocio_id = $1 AND data LIKE $2 AND status <> 'cancelado'
          GROUP BY nome ORDER BY qtd DESC LIMIT 1
        `, [n.id, prefixo + '-%'])).rows[0];

        const linhas = [
          `<tr><td style="padding:10px 14px;color:#64748b">📅 Agendamentos</td><td style="padding:10px 14px;font-weight:700;text-align:right">${stats.total}</td></tr>`,
          `<tr><td style="padding:10px 14px;color:#64748b">✅ Concluídos</td><td style="padding:10px 14px;font-weight:700;text-align:right">${stats.concluidos}</td></tr>`,
          `<tr><td style="padding:10px 14px;color:#64748b">💰 Faturamento (concluídos)</td><td style="padding:10px 14px;font-weight:700;text-align:right;color:#0d9488">${fmtReal(stats.faturamento)}</td></tr>`,
        ];
        if (topServico) linhas.push(`<tr><td style="padding:10px 14px;color:#64748b">⭐ Serviço mais pedido</td><td style="padding:10px 14px;font-weight:700;text-align:right">${topServico.servico} (${topServico.qtd}x)</td></tr>`);
        if (topCliente) linhas.push(`<tr><td style="padding:10px 14px;color:#64748b">🏆 Cliente mais frequente</td><td style="padding:10px 14px;font-weight:700;text-align:right">${topCliente.nome} (${topCliente.qtd}x)</td></tr>`);

        const ok = await enviarEmail({
          fromName: 'AgendaOK',
          to: n.email,
          subject: `📊 Seu mês no AgendaOK — ${n.nome_negocio} em ${nomeMes}`,
          html: `
<div style="font-family:Arial;max-width:520px;margin:0 auto;padding:32px">
  <h2 style="color:#0d9488;margin:0 0 6px">Seu mês no AgendaOK 📊</h2>
  <p style="font-size:14px;color:#64748b;margin:0 0 20px"><strong>${n.nome_negocio}</strong> · ${nomeMes}</p>
  <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;overflow:hidden;font-size:14px">
    ${linhas.join('')}
  </table>
  <p style="text-align:center;margin:26px 0 0">
    <a href="${(process.env.BASE_URL || 'https://agendaok.online')}/painel" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Abrir meu painel</a>
  </p>
  <p style="font-size:12px;color:#94a3b8;margin-top:24px;text-align:center">© 2026 AgendaOK — resumo automático mensal</p>
</div>`,
        });
        if (ok) enviados++;
      } catch(e) { console.error(`Relatório ${n.nome_negocio}:`, e.message); }
    }
    console.log(`📊 Relatório mensal: ${enviados} e-mail(s) enviado(s)`);
  } catch(e) {
    console.error('❌ Erro relatório mensal:', e.message);
  }
}

module.exports = { rodarRelatorioMensal };
