// ── Backup semanal do banco por e-mail ───────────────────────────────────────
// Exporta todas as tabelas (exceto sessões) como JSON compactado (.json.gz)
// e envia para BACKUP_EMAIL (ou EMAIL_USER como fallback).
//
// Não substitui o backup do Railway — é uma cópia de segurança EXTERNA,
// para o caso de perda total do projeto/banco na plataforma.
//
// Variável opcional: BACKUP_EMAIL=seuemail@gmail.com

const zlib = require('zlib');
const { pool } = require('../middleware/database');
const { enviarEmail } = require('../middleware/mailer');

const LIMITE_ANEXO_MB = 15; // limite de segurança p/ e-mail (Gmail aceita 25MB)

async function rodarBackupBanco() {
  const destino = process.env.BACKUP_EMAIL || process.env.EMAIL_USER;
  if (!destino) {
    console.log('⚠️  Backup: nenhum destino configurado (BACKUP_EMAIL ou EMAIL_USER). Pulando.');
    return;
  }

  try {
    console.log('💾 Backup: iniciando exportação do banco...');

    // Lista todas as tabelas do schema public, exceto a de sessões
    const tabelas = (await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'session'
      ORDER BY tablename
    `)).rows.map(r => r.tablename);

    const dump = { gerado_em: new Date().toISOString(), tabelas: {} };
    for (const t of tabelas) {
      // Nome vem do próprio catálogo do Postgres (seguro), entre aspas por precaução
      const rows = (await pool.query(`SELECT * FROM "${t}"`)).rows;
      dump.tabelas[t] = rows;
    }

    const json = JSON.stringify(dump);
    const gz   = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
    const mb   = gz.length / (1024 * 1024);

    const dataStr = new Date().toISOString().split('T')[0];
    const resumo  = tabelas.map(t => `<li><strong>${t}</strong>: ${dump.tabelas[t].length} registros</li>`).join('');

    if (mb > LIMITE_ANEXO_MB) {
      // Banco cresceu demais para e-mail — avisa em vez de falhar em silêncio
      await enviarEmail({
        fromName: 'AgendaOK Backup',
        to: destino,
        subject: `⚠️ Backup AgendaOK ${dataStr} — grande demais para anexar (${mb.toFixed(1)}MB)`,
        html: `<p>O backup compactado ficou com <strong>${mb.toFixed(1)}MB</strong> e passou do limite de ${LIMITE_ANEXO_MB}MB para envio por e-mail.</p>
               <p>Hora de migrar o backup para um storage (S3, R2, Google Drive). Tabelas atuais:</p><ul>${resumo}</ul>`,
      });
      console.warn(`⚠️  Backup: ${mb.toFixed(1)}MB — grande demais p/ e-mail, aviso enviado.`);
      return;
    }

    const ok = await enviarEmail({
      fromName: 'AgendaOK Backup',
      to: destino,
      subject: `💾 Backup AgendaOK — ${dataStr} (${(mb * 1024).toFixed(0)}KB)`,
      html: `<p>Backup semanal do banco em anexo (JSON compactado com gzip).</p>
             <p>Para abrir: descompacte o .gz (7-Zip/WinRAR) e o conteúdo é um JSON legível.</p>
             <ul>${resumo}</ul>
             <p style="font-size:12px;color:#94a3b8">Guarde este e-mail — é sua cópia externa de segurança.</p>`,
      attachments: [{ filename: `agendaok-backup-${dataStr}.json.gz`, content: gz }],
    });

    if (ok) console.log(`✅ Backup enviado para ${destino} (${(mb * 1024).toFixed(0)}KB, ${tabelas.length} tabelas)`);
    else    console.error('❌ Backup: falha no envio do e-mail.');
  } catch (e) {
    console.error('❌ Backup falhou:', e.message);
  }
}

module.exports = { rodarBackupBanco };
