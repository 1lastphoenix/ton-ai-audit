FROM node:20-alpine

WORKDIR /bridge

RUN apk add --no-cache git bash

COPY package.json ./
COPY server.mjs ./
RUN npm install --omit=dev

RUN git clone --depth 1 https://github.com/ton-blockchain/ton-language-server.git /opt/ton-language-server

ENV PORT=3002
ENV TON_LSP_COMMAND=node
ENV TON_LSP_ARGS="/opt/ton-language-server/server.js --stdio"

EXPOSE 3002

CMD ["node", "server.mjs"]
