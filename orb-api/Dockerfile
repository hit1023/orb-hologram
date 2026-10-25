FROM node:22-slim
# Claude Code の headless 実行は root だと拒否されるため、非rootで動かす
RUN useradd -m -s /bin/bash appuser
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY server.js store.js mood.js ./
RUN mkdir -p /data/claude-config /data/db && chown -R appuser:appuser /data/claude-config /data/db
ENV CLAUDE_CONFIG_DIR=/data/claude-config PORT=3000 DB_PATH=/data/db/orb.db
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
