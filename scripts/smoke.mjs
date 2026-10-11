process.env.TELEGRAM_BOT_TOKEN = '000000000:TEST_TOKEN_FOR_SMOKE';
process.env.ADMIN_TELEGRAM_IDS = '123456789';
process.env.TELEGRAM_TARGET_CHAT_ID = '-1001234567890';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.WHATSAPP_ENABLED = 'false';
process.env.DB_PATH = '/tmp/infomaulid-smoke.db';

const { getDb, closeDb } = await import('../dist/database/db.js');
const { createSubmission, getSubmissionById, updateSubmissionStatus } = await import('../dist/database/submissions.js');
const { createBot } = await import('../dist/bot/index.js');
const { INFOMAULID_COPYWRITING_TEMPLATE } = await import('../dist/templates/infomaulid.js');
const { ensureDownloadsDir } = await import('../dist/utils/download.js');

ensureDownloadsDir();
getDb();
const sub = createSubmission({
  telegramUserId: 1,
  telegramUsername: 'smoke',
  telegramFullName: 'Smoke Test',
  posterFilePath: '/tmp/fake.jpg',
  posterFileId: 'file-id',
  userText: 'test caption',
});
const updated = updateSubmissionStatus(sub.id, 'AI_PROCESSING');
const loaded = getSubmissionById(updated.id);
const bot = createBot();

if (!loaded || loaded.status !== 'AI_PROCESSING') throw new Error('DB workflow failed');
if (!bot) throw new Error('Bot create failed');
if (!INFOMAULID_COPYWRITING_TEMPLATE.includes('PASTE INFOMAULID COPYWRITING TEMPLATE HERE')) {
  throw new Error('Template placeholder missing unexpectedly');
}

closeDb();
console.log('SMOKE_OK', {
  submissionId: loaded.id,
  status: loaded.status,
  botTokenSet: Boolean(bot.token),
  templatePlaceholderPresent: true,
});
