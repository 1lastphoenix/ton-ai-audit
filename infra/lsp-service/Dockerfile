FROM node:22-bookworm-slim

WORKDIR /bridge

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server.mjs ./
RUN npm install --omit=dev

RUN git clone --depth 1 https://github.com/ton-blockchain/ton-language-server.git /opt/ton-language-server
RUN cd /opt/ton-language-server \
  && corepack enable \
  && yarn install --immutable \
  && yarn grammar:wasm \
  && yarn build
RUN test -f /opt/ton-language-server/dist/tree-sitter-tolk.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-func.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-fift.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-tlb.wasm

ENV PORT=3002
ENV TON_LSP_COMMAND=node
ENV TON_LSP_ARGS="/opt/ton-language-server/dist/server.js --stdio"

EXPOSE 3002

CMD ["node", "server.mjs"]
