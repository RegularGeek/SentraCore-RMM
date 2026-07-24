# SentraCore RMM server image. Only the server is containerized — agents
# run directly on the machines you're monitoring, not in a container here.
FROM node:20-bookworm-slim

# better-sqlite3 needs a native build toolchain at install time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

# SQLite file lives here — mount a volume at this path so data survives
# container restarts/rebuilds.
VOLUME ["/app/data"]
ENV DB_PATH=/app/data/rmm.db

EXPOSE 8787
CMD ["node", "server.js"]
