FROM node:22-slim

WORKDIR /app

# Copy everything
COPY . .

# Install server dependencies
RUN cd server && npm ci

# Install client dependencies and build
RUN cd client && npm install && npm run build

EXPOSE 3000

CMD ["node", "server/index.js"]
