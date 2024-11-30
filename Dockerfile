FROM oven/bun:latest

COPY . .

RUN bun install

EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "src/index.js" ]