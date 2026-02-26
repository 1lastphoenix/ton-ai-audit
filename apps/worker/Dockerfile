FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium-browser

RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont \
  && rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && npm install -g pnpm@10.5.2

# Create non-root user before installing dependencies.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --chown=appuser:appgroup package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=appuser:appgroup apps/worker/package.json apps/worker/package.json
COPY --chown=appuser:appgroup apps/web/package.json apps/web/package.json
COPY --chown=appuser:appgroup packages/shared/package.json packages/shared/package.json

# Ensure non-root user can create temp/store files during pnpm install.
RUN mkdir -p /pnpm /app && chown -R appuser:appgroup /pnpm /app

USER appuser

RUN pnpm install --frozen-lockfile

COPY --chown=appuser:appgroup . .

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@ton-audit/worker", "start"]
