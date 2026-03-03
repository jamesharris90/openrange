# syntax=docker/dockerfile:1

# Build client (Vite) and install server deps
FROM node:22-slim AS build
WORKDIR /app

# Build tools needed for native modules (better-sqlite3 / node-gyp fallback)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install deps with good layer caching
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN cd server && npm ci
RUN cd client && npm ci

# Copy source and build frontend
COPY . .
RUN cd client && npm run build


# Runtime image
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Build tools needed for native module install (better-sqlite3 / node-gyp fallback)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install only production deps for the server
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source and built client assets
COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# Copy legacy static assets referenced by production server
COPY pages ./pages
COPY js ./js
COPY styles.css ./
COPY ["logo pack", "./logo pack/"]

# Railway provides $PORT; server/index.js uses process.env.PORT
EXPOSE 3000
# --experimental-strip-types: required for Node 22 to load .ts files via require()
CMD ["node", "--experimental-strip-types", "server/index.js"]
