# InfoMaulid Bot

Telegram bot that accepts Islamic event posters, extracts event details with Google Gemini Vision, generates Bahasa Melayu copywriting from the InfoMaulid template, sends the result to admins for review, and only publishes after explicit admin approval.

**AI never publishes automatically.**

Workflow:

`SUBMITTED → AI_PROCESSING → ADMIN_REVIEW → APPROVED → PUBLISHED`

---

## Features

- Accept poster only, or poster + caption/text
- Gemini Vision extraction (title, date, time, location, speakers, organizer, contact, registration link, other info)
- Strict InfoMaulid Bahasa Melayu copywriting (template in `src/templates/infomaulid.ts`)
- Admin review buttons: **APPROVE / EDIT / REGENERATE / REJECT**
- Publish to Telegram channel/group + WhatsApp (independent publishers)
- SQLite storage for submissions and publish statuses
- Retry WhatsApp without reposting Telegram if WhatsApp fails

---

## 1. Create the Telegram bot (BotFather)

1. Open Telegram and chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name, e.g. `InfoMaulid Bot`
4. Choose a username ending with `bot`, e.g. `InfoMaulidBot`
5. Copy the **HTTP API token** → this is `TELEGRAM_BOT_TOKEN`
6. Optional: `/setdescription`, `/setabouttext`, `/setuserpic`

---

## 2. Get your Telegram User ID

You need your numeric Telegram user ID for admin access.

Easy options:

1. Message [@userinfobot](https://t.me/userinfobot) or [@getidsbot](https://t.me/getidsbot)
2. Or message [@RawDataBot](https://t.me/RawDataBot) and read `message.from.id`

Example: `123456789`

---

## 3. Configure `ADMIN_TELEGRAM_IDS`

In `.env`:

```env
ADMIN_TELEGRAM_IDS=123456789
```

Multiple admins (comma-separated):

```env
ADMIN_TELEGRAM_IDS=123456789,987654321
```

Only these IDs can approve, edit, regenerate, reject, or publish.

---

## 4. Add the bot to your Telegram channel/group

### Channel

1. Open your channel → Administrators → Add Admin
2. Add your bot
3. Grant at least **Post Messages** permission

### Group / supergroup

1. Add the bot to the group
2. Make it admin if your group restricts posting
3. Grant permission to send photos/messages

---

## 5. Get `TELEGRAM_TARGET_CHAT_ID`

### Channel

- Forward a channel post to [@userinfobot](https://t.me/userinfobot) / [@getidsbot](https://t.me/getidsbot), **or**
- Use the channel username style: `@yourchannel`
- Private channels usually look like `-100xxxxxxxxxx`

### Group

1. Add [@RawDataBot](https://t.me/RawDataBot) temporarily, or inspect updates
2. Read `chat.id` (often negative, e.g. `-1001234567890`)

Put it in `.env`:

```env
TELEGRAM_TARGET_CHAT_ID=-1001234567890
```

---

## 6. Configure Google Gemini API

1. Create a free API key at [Google AI Studio](https://aistudio.google.com/apikey)
2. Put it in `.env`:

```env
GEMINI_API_KEY=...
```

Optional overrides:

```env
GEMINI_VISION_MODEL=gemini-flash-lite-latest
GEMINI_COPY_MODEL=gemini-flash-lite-latest
```

---

## 7. Configure WhatsApp publishing

WhatsApp is optional and independent from Telegram.

### Recommended: Personal WhatsApp (no Meta API)

Uses WhatsApp Web login (Baileys). Scan QR once, then the bot can send poster + caption to your number.

```env
WHATSAPP_ENABLED=true
WHATSAPP_PROVIDER=baileys
WHATSAPP_TARGET_NUMBER=60123456789
```

Multiple recipients (same linked WhatsApp account sends to all):

```env
WHATSAPP_TARGET_NUMBER=60123456789,601987654321
```

Also publish to a WhatsApp Channel (account must be channel admin):

```env
WHATSAPP_CHANNEL_ENABLED=true
WHATSAPP_CHANNEL_INVITE=https://whatsapp.com/channel/0029Va4ANcRFi8xZJlLJN93E
```

Then:

1. Start the bot (`npm run dev`)
2. Bot sends a QR image to your Telegram admin chat
3. On your phone: WhatsApp → Settings → Linked Devices → Link a Device → scan QR
4. Send `/whatsapp` anytime to check connection status

Session is stored in `data/whatsapp-auth/` (gitignored).

### Disable WhatsApp

```env
WHATSAPP_ENABLED=false
WHATSAPP_PROVIDER=baileys
WHATSAPP_TARGET_NUMBER=
```

When disabled, publish flow marks WhatsApp as **Skipped** and still completes Telegram publishing.

### Optional: WhatsApp Cloud API (Meta)

```env
WHATSAPP_ENABLED=true
WHATSAPP_PROVIDER=meta
WHATSAPP_TARGET_NUMBER=60123456789
WHATSAPP_ACCESS_TOKEN=EAAB...
WHATSAPP_PHONE_NUMBER_ID=1234567890
```

If Telegram succeeds and WhatsApp fails, the bot does **not** repost Telegram. Admin gets **RETRY WHATSAPP**.

---

## 8. Run locally

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
cp .env.example .env
# edit .env with your real values
npm install
```

### Paste your copywriting template

Edit `src/templates/infomaulid.ts` and replace:

```text
PASTE INFOMAULID COPYWRITING TEMPLATE HERE
```

### Dev mode (auto-reload)

```bash
npm run dev
```

### Production-style local run

```bash
npm run build
npm start
```

### Typecheck only

```bash
npm run typecheck
```

Then in Telegram:

1. Open your bot
2. Send `/start`
3. Send an event poster (optionally with caption)
4. Admin account receives review controls

---

## 9. Push the project to GitHub

> Do this only when you are ready. Secrets must never be committed.

```bash
# create empty repo on GitHub first, then:
git remote add origin https://github.com/<your-username>/<your-repo>.git
git branch -M main
git add .
git status   # confirm .env is NOT staged
git commit -m "Initial InfoMaulid Bot"
git push -u origin main
```

Ensure `.gitignore` includes:

- `.env`
- `*.db` / `*.sqlite`
- `downloads/`
- `logs/`

---

## 10. Deploy to a server / VPS later

Example with Ubuntu + systemd + Node.js:

1. Provision a VPS
2. Install Node.js 18+
3. Clone the repo
4. Copy `.env` to the server (never commit it)
5. Install & build:

```bash
npm install
npm run build
```

6. Create a systemd service, e.g. `/etc/systemd/system/infomaulid-bot.service`:

```ini
[Unit]
Description=InfoMaulid Telegram Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/infomaulid-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

7. Enable & start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable infomaulid-bot
sudo systemctl start infomaulid-bot
sudo systemctl status infomaulid-bot
```

Keep long polling for simplicity, or later switch to webhooks behind Nginx if needed.

---

## Project structure

```text
src/
  bot/           # Telegram handlers, admin review UI, workflow
  ai/            # Gemini Vision extraction + copywriting
  database/      # SQLite schema + submission helpers
  publishers/
    telegram.ts  # Telegram channel/group publisher
    whatsapp.ts  # WhatsApp publisher (Meta Cloud API)
  templates/     # InfoMaulid copywriting template
  utils/         # download, logger
  config.ts
  index.ts
```

---

## Admin review actions

| Button | Behavior |
|---|---|
| APPROVE | Ask for CONFIRM & PUBLISH / CANCEL |
| CONFIRM & PUBLISH | Post poster + caption to Telegram, then WhatsApp |
| EDIT | Admin sends new caption text, then preview |
| REGENERATE | New caption from same extracted info |
| REJECT | Mark rejected; never publish |
| RETRY WHATSAPP | Retry WhatsApp only (no Telegram repost) |

---

## Environment variables

Copy from `.env.example`:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | From BotFather |
| `ADMIN_TELEGRAM_IDS` | Yes | Comma-separated admin user IDs |
| `TELEGRAM_TARGET_CHAT_ID` | Yes | Channel/group chat ID |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GEMINI_VISION_MODEL` | No | Default `gemini-flash-lite-latest` |
| `GEMINI_COPY_MODEL` | No | Default `gemini-flash-lite-latest` |
| `WHATSAPP_ENABLED` | No | `true` / `false` (default false) |
| `WHATSAPP_PROVIDER` | No | `baileys` (personal) or `meta` |
| `WHATSAPP_TARGET_NUMBER` | If WA enabled | Destination number(s), comma-separated |
| `WHATSAPP_CHANNEL_ENABLED` | No | `true` to also post to WhatsApp Channel |
| `WHATSAPP_CHANNEL_INVITE` | If channel on | Channel invite code or full URL |
| `WHATSAPP_ACCESS_TOKEN` | If Meta WA | Meta access token |
| `WHATSAPP_PHONE_NUMBER_ID` | If Meta WA | Meta phone number ID |

---

## License

MIT
