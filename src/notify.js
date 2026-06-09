import axios from 'axios';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendTelegram(settings, message) {
  const token = String(settings.telegram_bot_token || '').trim();
  const chatId = String(settings.telegram_chat_id || '').trim();
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true
    }, { timeout: 12000 });
  } catch (_e) {
  }
}

export async function sendRestockTelegram(settings, message) {
  const token = String(settings.telegram_bot_token || '').trim();
  const chatId = String(settings.telegram_restock_chat_id || '').trim();
  if (!token || !chatId) return;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, { timeout: 12000 });
  } catch (_e) {
  }
}

export { escapeHtml };
