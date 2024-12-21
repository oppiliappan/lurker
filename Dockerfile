FROM oven/bun:latest
ADD ./ ./
RUN mkdir -p /data
WORKDIR /data
CMD ["bun", "run", "/home/bun/app/src/index.js"]