FROM node:20-alpine

WORKDIR /sandbox

RUN apk add --no-cache bash git docker-cli

COPY package.json ./
COPY server.mjs ./
COPY pinned-toolchain.json ./

RUN npm install --omit=dev

ENV PORT=3003
ENV SANDBOX_EXECUTION_MODE=local
ENV SANDBOX_DOCKER_IMAGE=node:20-alpine

EXPOSE 3003

CMD ["node", "server.mjs"]
