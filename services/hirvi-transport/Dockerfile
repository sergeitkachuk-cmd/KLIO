FROM gogost/gost:3.3.3@sha256:f266f957c6e4f8d433ed23202a5745fa4969d08f3f0ef034fb9357345e16ad67 AS gost
FROM caddy:2.11.9-alpine AS caddy
FROM ghcr.io/sergeitkachuk-cmd/klio-relay:71a48fc0a1d97b587832bac9aa18b44efe62b4b4
LABEL org.opencontainers.image.source="https://github.com/sergeitkachuk-cmd/KLIO"
COPY --from=gost /bin/gost /usr/local/bin/gost
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY services/hirvi-transport/start.mjs /opt/hirvi-transport/start.mjs
COPY services/hirvi-transport/original-command.json /opt/hirvi-transport/original-command.json
ENTRYPOINT ["node", "/opt/hirvi-transport/start.mjs"]
CMD []
