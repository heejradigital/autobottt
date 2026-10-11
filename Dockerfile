FROM node:20-alpine

WORKDIR /app

# Install native dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (devDependencies such as typescript are needed to build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Create necessary directories
RUN mkdir -p downloads logs data

# Expose no ports (bot runs as client)
CMD ["node", "dist/index.js"]
