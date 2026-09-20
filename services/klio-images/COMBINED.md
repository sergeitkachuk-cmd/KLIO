# Existing paid Render service: Telegram plus images

The supplied Settings screenshot identifies `aiogram/telegram-bot-api:latest`
as the current image for `klio-telegram-relay` in Oregon. The combined image
extends that upstream image, retaining its Telegram binary, user, entrypoint
configuration and data directory defaults. It adds Node and a shared listener.
It does not need a second Render service. Capacity must still be observed on
the current plan; external image generation remains separately billed.

## Before switching the existing service

- Record the exact current image digest for rollback, environment variable
  names, any Docker command override and persistent disk mount paths. Keep
  Telegram secrets in Render. Do not reset or migrate Telegram credentials.
- If a custom Docker command is set, review it before changing the image.
  The combined entrypoint runs the upstream `/docker-entrypoint.sh` without
  extra arguments. Custom command overrides are not automatically preserved.
- Review upstream Telegram binary version against the existing deployment.
  The `latest` base is resolved at build time and may differ from the image
  pulled by Render earlier. A data backup is needed before a version upgrade.
- A restart affects both functions. Use a quiet deployment window and check
  Telegram with a read-only operation afterwards. Do not send test posts to
  customer channels.

## Container publication

`.github/workflows/image-relay.yml` builds and tests the container on the
dedicated `codex/klio-image-service` branch, then publishes an immutable tag:
`ghcr.io/sergeitkachuk-cmd/klio-relay:<full-commit-sha>`.
It never changes the Render service automatically or deploys the main website.
Do not use a tag until its workflow has passed. GHCR packages may initially be
private: make this code-only package public in GitHub package settings or use
an appropriate registry credential in Render, then verify pull access.

## Render settings after the image is verified

Use the existing `klio-telegram-relay` service. Keep its domain, region, plan,
Telegram environment settings and mounted disk. Replace Image Source with
the tested immutable combined image reference. Add:

- `OPENAI_API_KEY`: eligible image provider key.
- `KLIO_IMAGE_SERVICE_TOKEN`: new random secret of at least 32 characters.
- `KLIO_IMAGE_MODEL`: optional, default `gpt-image-2.5-flare-2026-09-08`
  (the dated snapshot, not the bare rolling alias - see server.mjs's own
  comment on why).

Use `/health/telegram` as Health Check Path. This probes the loopback listener,
not the Telegram account's authorization. `/health` separately checks image
configuration; missing image settings do not disable Telegram.

The public port uses `PORT`, otherwise the existing `TELEGRAM_HTTP_PORT`,
otherwise 8081. Telegram's internal listener moves to loopback port 18081
(18082 if the public port is 18081). Existing `/bot.../method` and
`/file/bot.../path` requests are streamed through unchanged. The image endpoint
is `/generate`, requires the shared token, and permits two concurrent jobs.
Child process failure terminates the container. Raw Telegram child logs are
suppressed to avoid exposing bot-token URLs; only lifecycle failures are logged.

## Timeweb App Platform

After deploying the dialogue feature on the main website, add:

- `KLIO_IMAGE_SERVICE_URL=https://klio-telegram-relay.onrender.com`
- `KLIO_IMAGE_SERVICE_TOKEN`: the same new secret as Render.

Retain existing S3 settings. Verify real image generation through an authorized
test account, saved image loading from the website without VPN, and read-only
Telegram connectivity. No such production acceptance check has yet been done.

## Rollback

Restore the previous exact Docker image, command override and health-check
configuration in Render. Keep all Telegram variables and data. The original
Telegram-only image ignores the added image variables. Disable the image
feature on the main site until corrected. If the Telegram binary changed,
assess data-format compatibility before restoring an older binary.
