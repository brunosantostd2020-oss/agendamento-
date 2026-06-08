const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../middleware/database');
const { requireAuth } = require('../middleware/auth');

// ── LISTAR ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM funcionarios WHERE negocio_id=$1 ORDER BY nome ASC',
      [req.session.userId]
    );
    res.json({ funcionarios: r.rows });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── CRIAR ─────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { nome, cargo, telefone, email, salario_fixo, comissao_pct, cor } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome obrigatório.' });
  try {
    const agora = new Date().toLocaleString('pt-BR');
    const id = uuidv4();
    await pool.query(
      `INSERT INTO funcionarios (id,negocio_id,nome,cargo,telefone,email,salario_fixo,comissao_pct,ativo,cor,criado_em,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$10)`,
      [id, req.session.userId, nome.trim(), cargo||'', telefone||'', email||'',
       parseFloat(salario_fixo)||0, parseFloat(comissao_pct)||0,
       cor||'#00d084', agora]
    );
    const novo = (await pool.query('SELECT * FROM funcionarios WHERE id=$1', [id])).rows[0];
    res.status(201).json({ sucesso: true, funcionario: novo });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── EDITAR ────────────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  const { nome, cargo, telefone, email, salario_fixo, comissao_pct, cor, ativo } = req.body;
  try {
    const agora = new Date().toLocaleString('pt-BR');
    await pool.query(
      `UPDATE funcionarios SET
        nome=$1, cargo=$2, telefone=$3, email=$4,
        salario_fixo=$5, comissao_pct=$6, cor=$7, ativo=$8, atualizado_em=$9
       WHERE id=$10 AND negocio_id=$11`,
      [nome, cargo||'', telefone||'', email||'',
       parseFloat(salario_fixo)||0, parseFloat(comissao_pct)||0,
       cor||'#00d084', ativo !== false, agora,
       req.params.id, req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── EXCLUIR ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM funcionarios WHERE id=$1 AND negocio_id=$2',
      [req.params.id, req.session.userId]);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── RELATÓRIO DE COMISSÃO ─────────────────────────────────────
// GET /funcionarios/:id/comissao?mes=2026-06
router.get('/:id/comissao', requireAuth, async (req, res) => {
  const { mes } = req.query; // formato YYYY-MM
  const periodo = mes || new Date().toISOString().slice(0,7);

  try {
    const func = (await pool.query(
      'SELECT * FROM funcionarios WHERE id=$1 AND negocio_id=$2',
      [req.params.id, req.session.userId]
    )).rows[0];
    if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado.' });

    // Agendamentos concluídos no mês vinculados a este funcionário
    const ags = (await pool.query(
      `SELECT * FROM agendamentos
       WHERE negocio_id=$1 AND funcionario_id=$2
       AND status='concluido' AND data LIKE $3`,
      [req.session.userId, req.params.id, periodo + '%']
    )).rows;

    const totalBruto = ags.reduce((s, a) => s + parseFloat(a.preco_servico||0), 0);
    const comissaoValor = totalBruto * (parseFloat(func.comissao_pct)||0) / 100;
    const totalAPagar = parseFloat(func.salario_fixo||0) + comissaoValor;

    res.json({
      funcionario: func,
      periodo,
      atendimentos: ags.length,
      total_bruto: totalBruto,
      comissao_pct: func.comissao_pct,
      comissao_valor: comissaoValor,
      salario_fixo: func.salario_fixo,
      total_a_pagar: totalAPagar,
      agendamentos: ags,
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── RESUMO GERAL (todos os funcionários no mês) ───────────────
// GET /funcionarios/resumo?mes=2026-06
router.get('/resumo/mes', requireAuth, async (req, res) => {
  const { mes } = req.query;
  const periodo = mes || new Date().toISOString().slice(0,7);

  try {
    const funcs = (await pool.query(
      'SELECT * FROM funcionarios WHERE negocio_id=$1 AND ativo=true ORDER BY nome ASC',
      [req.session.userId]
    )).rows;

    // Total geral do estabelecimento no mês
    const totGeral = (await pool.query(
      `SELECT COALESCE(SUM(preco_servico),0) as total
       FROM agendamentos
       WHERE negocio_id=$1 AND status='concluido' AND data LIKE $2 AND preco_servico IS NOT NULL`,
      [req.session.userId, periodo + '%']
    )).rows[0].total;

    // Total de agendamentos sem funcionário vinculado
    const semFunc = (await pool.query(
      `SELECT COUNT(*) as qtd, COALESCE(SUM(preco_servico),0) as total
       FROM agendamentos
       WHERE negocio_id=$1 AND status='concluido' AND data LIKE $2 AND funcionario_id IS NULL`,
      [req.session.userId, periodo + '%']
    )).rows[0];

    const resumos = await Promise.all(funcs.map(async f => {
      const ags = (await pool.query(
        `SELECT * FROM agendamentos
         WHERE negocio_id=$1 AND funcionario_id=$2
         AND status='concluido' AND data LIKE $3`,
        [req.session.userId, f.id, periodo + '%']
      )).rows;

      const bruto = ags.reduce((s,a) => s + parseFloat(a.preco_servico||0), 0);
      const comissao = bruto * (parseFloat(f.comissao_pct)||0) / 100;
      const total_a_pagar = parseFloat(f.salario_fixo||0) + comissao;

      return {
        id: f.id, nome: f.nome, cargo: f.cargo, cor: f.cor,
        atendimentos: ags.length,
        total_bruto: bruto,
        comissao_pct: f.comissao_pct,
        comissao_valor: comissao,
        salario_fixo: f.salario_fixo,
        total_a_pagar,
      };
    }));

    const totalFolha = resumos.reduce((s,r) => s + r.total_a_pagar, 0);
    const totalComissoes = resumos.reduce((s,r) => s + r.comissao_valor, 0);

    res.json({
      periodo,
      total_estabelecimento: parseFloat(totGeral),
      total_folha: totalFolha,
      total_comissoes: totalComissoes,
      sem_funcionario: { qtd: parseInt(semFunc.qtd), total: parseFloat(semFunc.total) },
      funcionarios: resumos,
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── VINCULAR AGENDAMENTO A FUNCIONÁRIO ────────────────────────
router.patch('/agendamento/:agId/vincular', requireAuth, async (req, res) => {
  const { funcionario_id } = req.body;
  try {
    await pool.query(
      'UPDATE agendamentos SET funcionario_id=$1 WHERE id=$2 AND negocio_id=$3',
      [funcionario_id || null, req.params.agId, req.session.userId]
    );
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
