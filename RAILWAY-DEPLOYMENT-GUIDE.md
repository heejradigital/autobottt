# Railway Deployment Guide for InfoMaulid Bot

## Prerequisites

- GitHub account
- Railway account (sign up at https://railway.app)
- GitHub repository with the bot code

---

## Step 1: Push Code to GitHub

```bash
cd "C:\Users\Danial\Documents\Info Maulid\infomaulid-main\infomaulid-main"
git init
git add .
git commit -m "Initial commit for InfoMaulid Bot"
git branch -M main
# Create a new repository on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

⚠️ **IMPORTANT:** Ensure `.env` is NOT committed. It should be in `.gitignore`.

---

## Step 2: Connect Railway to GitHub

1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect it as a Node.js project

---

## Step 3: Configure Environment Variables

In Railway dashboard, go to your project → Settings → Variables

Add these environment variables:

```env
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
ADMIN_TELEGRAM_IDS=YOUR_ADMIN_TELEGRAM_ID
TELEGRAM_TARGET_CHAT_ID=YOUR_TARGET_CHAT_ID
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
WHATSAPP_ENABLED=true
WHATSAPP_PROVIDER=baileys
WHATSAPP_TARGET_NUMBER=YOUR_WHATSAPP_NUMBER
WHATSAPP_CHANNEL_ENABLED=true
WHATSAPP_CHANNEL_INVITE=https://whatsapp.com/channel/YOUR_CHANNEL_ID
WHATSAPP_INPUT_ENABLED=true
WHATSAPP_INPUT_OPEN=true
WHATSAPP_INPUT_NUMBERS=
WHATSAPP_REVIEW_VIA_WHATSAPP=true
WHATSAPP_ADMIN_REVIEW_NUMBER=YOUR_WHATSAPP_NUMBER
WHATSAPP_ADMIN_NUMBERS=YOUR_WHATSAPP_NUMBER,YOUR_ADMIN_NUMBER
TELEGRAM_INPUT_ENABLED=false
TELEGRAM_BOT_POLLING=false
WHATSAPP_PERSONAL_PUBLISH=true
GEMINI_VISION_MODEL=gemini-flash-lite-latest
GEMINI_COPY_MODEL=gemini-flash-lite-latest
```

---

## Step 4: Add Persistent Storage (Important!)

Railway's ephemeral filesystem will delete WhatsApp session on every redeploy. To persist data:

1. In Railway project, go to "Volumes"
2. Click "New Volume"
3. Name it: `data`
4. Mount path: `/data`
5. Add environment variable: `RAILWAY_VOLUME_MOUNT_PATH=/data`

This will persist:
- SQLite database
- WhatsApp auth session
- Downloaded posters

---

## Step 5: Deploy

Railway will automatically deploy when you push to GitHub.

Check deployment logs in Railway dashboard to ensure:
- Build succeeds
- Dependencies install
- Bot starts successfully

---

## Step 6: Scan WhatsApp QR Code

1. After deployment, check Railway logs
2. Look for QR code generation message
3. Check your WhatsApp (601154474066) for QR code image
4. Scan it: WhatsApp → Settings → Linked Devices → Link a Device

---

## Step 7: Verify Deployment

In Railway logs, look for:
- "InfoMaulid Bot boot"
- "WhatsApp client connected"
- "SQLite ready at /data/data/infomaulid.db"

---

## Troubleshooting

### Build Fails

Check logs for specific errors. Common issues:
- Node version mismatch (ensure >= 18)
- Dependency conflicts
- TypeScript compilation errors

### WhatsApp Session Lost on Redeploy

If WhatsApp session is lost after redeploy:
1. Ensure persistent storage is configured (Step 4)
2. Check `RAILWAY_VOLUME_MOUNT_PATH` is set
3. Verify volume is mounted correctly

### Database Errors

Ensure persistent storage is configured. Without it, database will be lost on every redeploy.

### Out of Memory

Railway's free tier has 512MB RAM. If you get OOM errors:
1. Upgrade to paid plan (1GB+ RAM)
2. Or deploy to Render.com (better free tier)

---

## Railway vs Other Platforms

| Platform | Free Tier | Persistent Storage | RAM | Notes |
|----------|-----------|-------------------|-----|-------|
| Railway | $5 credit then $5/mo | Yes (Volumes) | 512MB | Easy GitHub integration |
| Render | Free | Yes (Disk) | 512MB | Better free tier |
| Fly.io | Free allowance | Yes (Volumes) | 256MB | Global deployment |

---

## Update to Deploy

When you make code changes:

```bash
git add .
git commit -m "Your commit message"
git push
```

Railway will automatically redeploy.

---

## Monitoring

- View logs in Railway dashboard
- Check resource usage (CPU, RAM, Disk)
- Set up alerts for errors

---

## Cost

Railway free tier: $5 one-time credit, then $5/month.
For continuous 24/7 bot, consider:
- Paid Railway plan ($5-20/mo)
- Render.com (Free tier available)
- Fly.io (Free tier with limits)
