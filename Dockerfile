FROM node:18-alpine

WORKDIR /app

# Install native dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create necessary directories
RUN mkdir -p downloads logs data

# Expose no ports (bot runs as client)
CMD ["node", "dist/index.js"]
