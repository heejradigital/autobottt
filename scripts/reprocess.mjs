import 'dotenv/config';
import { createBot } from '../dist/bot/index.js';
import { getDb } from '../dist/database/db.js';
import { getSubmissionById } from '../dist/database/submissions.js';
import { processSubmissionPipeline } from '../dist/bot/processSubmission.js';

getDb();
const bot = createBot();
const id = Number(process.argv[2] || 1);
const sub = getSubmissionById(id);
if (!sub) {
  console.error('Submission not found', id);
  process.exit(1);
}
console.log('Reprocessing', id, sub.poster_file_path, 'status=', sub.status);
await processSubmissionPipeline(bot, id);
console.log('Done. Check Telegram admin chat.');
// Don't leave polling open
setTimeout(() => process.exit(0), 2000);
