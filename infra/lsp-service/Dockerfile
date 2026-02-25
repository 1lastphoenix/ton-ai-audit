FROM node:22-trixie-slim

WORKDIR /bridge

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server.mjs ./
RUN npm install --omit=dev

ARG TON_LSP_REPO=https://github.com/ton-blockchain/ton-language-server.git
ARG TON_LSP_GIT_REF=b9ff0dfcf8261b68e1053e5afb317ea98c43991a
RUN git init /opt/ton-language-server \
  && cd /opt/ton-language-server \
  && git remote add origin "${TON_LSP_REPO}" \
  && git fetch --depth 1 origin "${TON_LSP_GIT_REF}" \
  && git checkout --detach FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "${TON_LSP_GIT_REF}"
RUN cd /opt/ton-language-server \
  && corepack enable \
  && yarn install --immutable \
  && chmod +x /opt/ton-language-server/node_modules/tree-sitter-cli/tree-sitter \
  && yarn grammar:wasm \
  && yarn build \
  && mkdir -p /opt/ton-language-server/wasm \
  && for grammar in tolk func fift tlb; do \
      wasm_path="$(find /opt/ton-language-server -type f -name "tree-sitter-${grammar}.wasm" | head -n 1)"; \
      test -n "${wasm_path}"; \
      cp "${wasm_path}" "/opt/ton-language-server/wasm/tree-sitter-${grammar}.wasm"; \
      cp "${wasm_path}" "/opt/ton-language-server/dist/tree-sitter-${grammar}.wasm"; \
    done \
  && cp /opt/ton-language-server/dist/tree-sitter.wasm /opt/ton-language-server/wasm/tree-sitter.wasm
RUN test -f /opt/ton-language-server/wasm/tree-sitter-tolk.wasm \
  && test -f /opt/ton-language-server/wasm/tree-sitter-func.wasm \
  && test -f /opt/ton-language-server/wasm/tree-sitter-fift.wasm \
  && test -f /opt/ton-language-server/wasm/tree-sitter-tlb.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-tolk.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-func.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-fift.wasm \
  && test -f /opt/ton-language-server/dist/tree-sitter-tlb.wasm
RUN rm -rf /opt/ton-language-server/.git

ENV PORT=3002
ENV TON_LSP_COMMAND=node
ENV TON_LSP_ARGS="/opt/ton-language-server/dist/server.js --stdio"

EXPOSE 3002

CMD ["node", "server.mjs"]
