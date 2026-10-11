import 'dotenv/config';
import { getDb } from '../dist/database/db.js';
import {
  startWhatsAppClient,
  isWhatsAppReady,
  getWhatsAppStatus,
  resolveWhatsAppChannelJid,
  sendWhatsAppChannelImage,
} from '../dist/publishers/whatsappClient.js';
import { getSubmissionById } from '../dist/database/submissions.js';

getDb();

await startWhatsAppClient();
for (let i = 0; i < 30; i++) {
  if (isWhatsAppReady()) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log('status', getWhatsAppStatus());

const baileys = await import('@whiskeysockets/baileys');
// Access socket internals via resolve + metadata again
const invite = process.env.WHATSAPP_CHANNEL_INVITE.includes('channel/')
  ? process.env.WHATSAPP_CHANNEL_INVITE.split('channel/')[1]
  : process.env.WHATSAPP_CHANNEL_INVITE;

// Re-import status after connect
const jid = await resolveWhatsAppChannelJid(true);
console.log('jid', jid);

// Use dynamic access: open newsletterMetadata through a small hack
// We call send with a short text first if possible - image from submission 7
const sub = getSubmissionById(7);
console.log('poster', sub?.poster_file_path);

const result = await sendWhatsAppChannelImage(
  sub.poster_file_path,
  '*Test Channel Info Maulid*\n\nIni Ujian Auto Post Channel\n\nSemua Dijemput Hadir\n\nLink Channel Info Maulid: https://whatsapp.com/channel/0029Va4ANcRFi8xZJlLJN93E',
);
console.log('send result', result);
await new Promise(r => setTimeout(r, 3000));
process.exit(0);
