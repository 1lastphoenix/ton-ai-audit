FROM node:22-alpine

WORKDIR /bridge

RUN apk add --no-cache git bash

COPY package.json ./
COPY server.mjs ./
RUN npm install --omit=dev

RUN git clone --depth 1 https://github.com/ton-blockchain/ton-language-server.git /opt/ton-language-server
RUN cd /opt/ton-language-server \
  && corepack enable \
  && yarn install --immutable \
  && yarn build

ENV PORT=3002
ENV TON_LSP_COMMAND=node
ENV TON_LSP_ARGS="/opt/ton-language-server/dist/server.js --stdio"

EXPOSE 3002

CMD ["node", "server.mjs"]
