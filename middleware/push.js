// ── Web Push — notificações no celular/PC do dono, mesmo com o painel fechado ──
// Requisitos:
//   1. npm install  (pacote web-push já está no package.json)
//   2. Variáveis VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no ambiente
//      → gere com: npx web-push generate-vapid-keys
// Sem isso, o recurso fica silenciosamente desativado (nada quebra).

const { pool } = require('./database');

let webpush = null;
try {
  webpush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      'mailto:' + (process.env.VAPID_EMAIL || 'contato@agendaok.com'),
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    console.log('🔔 Web Push ativo!');
  } else {
    webpush = null;
    console.log('ℹ️  Web Push desativado — defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.');
  }
} catch(e) {
  webpush = null;
  console.log('ℹ️  Web Push desativado — rode "npm install" para instalar o pacote web-push.');
}

function pushAtivo() { return !!webpush; }

async function enviarPushUsuario(usuarioId, { titulo, corpo, url, urgente } = {}) {
  if (!webpush || !usuarioId) return;
  try {
    const subs = (await pool.query(
      'SELECT id, dados FROM push_subscriptions WHERE usuario_id=$1', [usuarioId]
    )).rows;
    if (!subs.length) return;

    const payload = JSON.stringify({
      title: titulo || 'AgendaOK',
      body:  corpo  || '',
      url:   url    || '/painel',
      urgente: !!urgente,
    });

    for (const s of subs) {
      try {
        await webpush.sendNotification(s.dados, payload);
      } catch(e) {
        // 404/410 = inscrição expirada (app desinstalado etc.) — limpa do banco
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [s.id]).catch(() => {});
        }
      }
    }
  } catch(e) { console.error('Push:', e.message); }
}

module.exports = { pushAtivo, enviarPushUsuario };
