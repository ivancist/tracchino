FROM node:24-bookworm

# System libraries for Playwright's Chromium (browser binary itself goes in a volume, see compose.yaml)
RUN npx -y playwright@latest install-deps chromium \
    && rm -rf /root/.npm /var/lib/apt/lists/*

# Pre-create volume mount points so named volumes inherit ownership by the non-root user
RUN mkdir -p /app/node_modules /home/node/.npm /home/node/.config /home/node/.cache/ms-playwright \
    && chown -R node:node /app /home/node

USER node
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
