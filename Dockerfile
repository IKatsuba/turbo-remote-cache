FROM denoland/deno:2.2.6

WORKDIR /app
COPY . .
RUN deno install

CMD ["deno", "task", "start"]
