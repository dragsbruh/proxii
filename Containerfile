FROM oven/bun:slim

WORKDIR /app

COPY package.json /app/package.json
COPY bun.lock /app/bun.lock

RUN bun install

COPY . /app


CMD ["bun", "start"]
