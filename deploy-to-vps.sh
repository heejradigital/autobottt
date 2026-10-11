#!/bin/bash

# InfoMaulid Bot Deployment Script
# Run this on VPS: 68.183.184.65

set -e

echo "========================================="
echo "InfoMaulid Bot Deployment to VPS"
echo "========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

echo -e "${GREEN}[1/10] Updating system...${NC}"
apt update && apt upgrade -y

echo -e "${GREEN}[2/10] Installing dependencies...${NC}"
apt install -y git curl python3 make g++ build-essential

echo -e "${GREEN}[3/10] Installing Node.js 18...${NC}"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt install -y nodejs
else
  echo "Node.js already installed: $(node --version)"
fi

echo -e "${GREEN}[4/10] Installing PM2 globally...${NC}"
npm install -g pm2

echo -e "${GREEN}[5/10] Creating deployment directory...${NC}"
mkdir -p /opt/infomaulid-bot
cd /opt/infomaulid-bot

echo -e "${GREEN}[6/10] Cloning repository...${NC}"
# Replace with your actual GitHub repo URL
# git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git .
echo "⚠️  Please upload your project files to /opt/infomaulid-bot"
echo "   You can use: scp -r /local/path/infomaulid-main/* root@68.183.184.65:/opt/infomaulid-bot/"

echo -e "${GREEN}[7/10] Installing dependencies...${NC}"
npm install

echo -e "${GREEN}[8/10] Building TypeScript...${NC}"
npm run build

echo -e "${GREEN}[9/10] Creating .env file...${NC}"
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${YELLOW}⚠️  Please edit .env with your real values:${NC}"
  echo "   nano /opt/infomaulid-bot/.env"
fi

echo -e "${GREEN}[10/10] Creating necessary directories...${NC}"
mkdir -p downloads logs data

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Deployment setup complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env file: nano /opt/infomaulid-bot/.env"
echo "2. Start with PM2: pm2 start ecosystem.config.cjs"
echo "3. Save PM2 config: pm2 save"
echo "4. Setup PM2 startup: pm2 startup"
echo ""
echo "View logs: pm2 logs infomaulid-bot"
echo "Check status: pm2 status"
