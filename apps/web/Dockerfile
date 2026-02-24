FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

# Create non-root user before installing dependencies.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

RUN pnpm --filter @ton-audit/web build

# Transfer ownership so the non-root user can write Next.js cache files.
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["pnpm", "--filter", "@ton-audit/web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
