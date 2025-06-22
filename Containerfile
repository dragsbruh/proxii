FROM oven/bun:slim

COPY . /app
WORKDIR /app

RUN bun install

CMD ["bun", "start"]
