import 'dotenv/config';
import { getDb } from '../dist/database/db.js';
import { getSubmissionById } from '../dist/database/submissions.js';
import {
  startWhatsAppClient,
  isWhatsAppReady,
  getWhatsAppStatus,
  sendWhatsAppChannelImage,
  stopWhatsAppClient,
} from '../dist/publishers/whatsappClient.js';

getDb();
const sub = getSubmissionById(Number(process.argv[2] || 7));
if (!sub) throw new Error('submission missing');

await startWhatsAppClient();
for (let i = 0; i < 40; i++) {
  if (isWhatsAppReady()) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log('status', getWhatsAppStatus());
if (!isWhatsAppReady()) {
  console.error('WA not ready');
  process.exit(1);
}

const caption = sub.final_caption || sub.generated_caption || 'Test';
console.log('sending channel image…');
const result = await sendWhatsAppChannelImage(sub.poster_file_path, caption);
console.log('result', result);
await stopWhatsAppClient();
process.exit(result.ok ? 0 : 1);
