import 'dotenv/config';
import { getDb } from '../dist/database/db.js';
import { getSubmissionById } from '../dist/database/submissions.js';
import P from 'pino';

// Patch config logger by wrapping send through a temporary socket with debug
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidNewsletter,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';

getDb();
const sub = getSubmissionById(7);
const authDir = path.join(process.cwd(), 'data', 'whatsapp-auth');
const { state, saveCreds } = await useMultiFileAuthState(authDir);
const { version } = await fetchLatestBaileysVersion();
const sock = makeWASocket({
  version,
  auth: state,
  logger: P({ level: 'debug' }),
  printQRInTerminal: false,
  syncFullHistory: false,
});
sock.ev.on('creds.update', saveCreds);

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), 20000);
  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'open') {
      clearTimeout(t);
      resolve();
    }
  });
});

const meta = await sock.newsletterMetadata('invite', '0029Va4ANcRFi8xZJlLJN93E');
const jid = meta.id.endsWith('@newsletter') ? meta.id : `${meta.id}@newsletter`;
console.log('jid', jid, 'isNewsletter', isJidNewsletter(jid));

const result = await sock.sendMessage(jid, {
  image: fs.readFileSync(sub.poster_file_path),
  caption: '*Ujian Channel*\nPatch Baileys Newsletter Media',
});
console.log('sent', result?.key?.id);
await new Promise((r) => setTimeout(r, 5000));
sock.end(undefined);
process.exit(0);
