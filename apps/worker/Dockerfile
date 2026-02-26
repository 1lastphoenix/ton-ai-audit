FROM mcr.microsoft.com/playwright:v1.56.1-noble

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && npm install -g pnpm@10.5.2

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

# Ensure Chromium is present in-image for PDF rendering jobs.
RUN pnpm --filter @ton-audit/worker exec playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production

RUN chown -R pwuser:pwuser /app

USER pwuser

CMD ["pnpm", "--filter", "@ton-audit/worker", "start"]
