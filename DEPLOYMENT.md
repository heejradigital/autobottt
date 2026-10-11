# VPS Deployment Guide

## Method 1: PM2 (Recommended)

### Prerequisites on VPS
- Ubuntu/Debian based VPS
- Node.js 18+ (`curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs`)
- Git (`sudo apt install git`)
- PM2 (`sudo npm install -g pm2`)

### Deployment Steps

1. **Clone repository**
```bash
git clone <your-repo-url> /opt/infomaulid-bot
cd /opt/infomaulid-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Build TypeScript**
```bash
npm run build
```

4. **Create .env file**
```bash
cp .env.example .env
nano .env
# Fill in all required values
```

5. **Create necessary directories**
```bash
mkdir -p downloads logs data
```

6. **Start with PM2**
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

7. **Monitor logs**
```bash
pm2 logs infomaulid-bot
pm2 status
```

### PM2 Commands
- `pm2 restart infomaulid-bot` - Restart bot
- `pm2 stop infomaulid-bot` - Stop bot
- `pm2 logs infomaulid-bot` - View logs
- `pm2 status` - Check status

---

## Method 2: Docker

### Prerequisites on VPS
- Docker (`curl -fsSL https://get.docker.com | sh`)
- Docker Compose

### Build and Run

1. **Clone repository**
```bash
git clone <your-repo-url> /opt/infomaulid-bot
cd /opt/infomaulid-bot
```

2. **Create .env file**
```bash
cp .env.example .env
nano .env
# Fill in all required values
```

3. **Build Docker image**
```bash
docker build -t infomaulid-bot .
```

4. **Run container**
```bash
docker run -d \
  --name infomaulid-bot \
  --restart unless-stopped \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/downloads:/app/downloads \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  infomaulid-bot
```

5. **View logs**
```bash
docker logs -f infomaulid-bot
```

### Docker Commands
- `docker restart infomaulid-bot` - Restart container
- `docker stop infomaulid-bot` - Stop container
- `docker logs -f infomaulid-bot` - View logs
- `docker exec -it infomaulid-bot sh` - Access container shell

---

## Method 3: Systemd (Alternative)

### Create systemd service file
```bash
sudo nano /etc/systemd/system/infomaulid-bot.service
```

Paste this content:
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

### Enable and start
```bash
sudo systemctl daemon-reload
sudo systemctl enable infomaulid-bot
sudo systemctl start infomaulid-bot
sudo systemctl status infomaulid-bot
```

### Systemd Commands
- `sudo systemctl restart infomaulid-bot` - Restart service
- `sudo systemctl stop infomaulid-bot` - Stop service
- `sudo journalctl -u infomaulid-bot -f` - View logs
- `sudo systemctl status infomaulid-bot` - Check status

---

## Important Notes

### Never commit .env
- `.env` is in `.gitignore` for security
- Always create `.env` manually on VPS
- Keep your API keys and tokens secret

### WhatsApp QR Code Scan
When using Baileys (personal WhatsApp):
1. Start the bot
2. Check Telegram admin chat for QR code
3. Scan with WhatsApp → Settings → Linked Devices → Link a Device
4. Session saved in `data/whatsapp-auth/`

### Database Location
- SQLite database: `data/infomaulid.db`
- Back up this file regularly

### Logs Location
- PM2: `logs/pm2-out.log` and `logs/pm2-error.log`
- Docker: `docker logs infomaulid-bot`
- Systemd: `journalctl -u infomaulid-bot`

### Updates
```bash
cd /opt/infomaulid-bot
git pull
npm install
npm run build
pm2 restart infomaulid-bot  # or systemctl restart, or docker restart
```
