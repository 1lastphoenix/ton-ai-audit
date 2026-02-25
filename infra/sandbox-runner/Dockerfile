FROM node:22-alpine

WORKDIR /sandbox

RUN apk add --no-cache bash git docker-cli

COPY package.json ./
COPY server.mjs ./
COPY pinned-toolchain.json ./
COPY scripts ./scripts

RUN npm install --omit=dev \
  && npm install -g \
  @ton/blueprint@0.43.0 \
  create-ton@0.31.0 \
  @tact-lang/compiler@1.6.13 \
  @ton/tolk-js@1.2.0 \
  @ton-community/func-js@0.11.0 \
  @ton/sandbox@0.41.0 \
  @ton/core@0.63.1 \
  @ton/ton@16.2.2 \
  @ton/crypto@3.3.0

ENV PORT=3003
ENV SANDBOX_EXECUTION_MODE=docker
ENV SANDBOX_DOCKER_IMAGE=ton-audit-sandbox-runner:latest

EXPOSE 3003

CMD ["node", "server.mjs"]
