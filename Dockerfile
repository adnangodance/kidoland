# syntax=docker/dockerfile:1

# Stage 1: Build the Vite frontend application
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

# Install build dependencies for native better-sqlite3 compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install server production dependencies
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy server application source
COPY server/src ./server/src

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Create persistent database directory
RUN mkdir -p /data && chown -R node:node /data /app

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    KIDOLAND_DB_PATH=/data/kidoland.sqlite

USER node

EXPOSE 4000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

WORKDIR /app/server
CMD ["npm", "start"]
