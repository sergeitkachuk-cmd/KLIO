# KLIO image service

Standalone server-side image generation. The existing Telegram relay is a separate service.

## Render setup

Create a Web Service from `sergeitkachuk-cmd/KLIO`:

| Field | Value |
| --- | --- |
| Branch | `codex/klio-image-service` |
| Name | `klio-images` |
| Language | Node |
| Root Directory | leave empty |
| Build Command | `echo "No dependencies"` |
| Start Command | `node services/klio-images/server.mjs` |
| Health Check Path | `/health` |

Select a region supported by your image API provider and account. Set these
environment variables directly in the Render dashboard:

- `NODE_VERSION`: `22.13.0`
- `OPENAI_API_KEY`: your eligible provider key
- `KLIO_IMAGE_SERVICE_TOKEN`: a random secret of at least 32 characters
- `KLIO_IMAGE_MODEL`: `gpt-image-1`

For example, generate a service token locally using
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Keep the value private; do not paste secrets into Git or conversations.

## Main application, Timeweb App Platform

After deploying the dialogue feature, configure the main application:

- `KLIO_IMAGE_SERVICE_URL`: the actual HTTPS URL Render assigns to this NEW service
- `KLIO_IMAGE_SERVICE_TOKEN`: the identical shared secret
- Keep the main application's existing S3 configuration for durable images.

Do not use `https://klio-telegram-relay.onrender.com` as the image service URL.
The caller authenticates server-to-server. Clients receive image URLs on the
main site's `/api/uploads/` path and do not call the provider directly.

This branch contains only the image service, not the dialogue UI or database
changes. Deployment of the main feature and real end-to-end verification on
the customer domain are still required. `/health` indicates configuration
presence, not successful provider access. Verify an actual generation and
load its saved URL on a client without VPN before announcing availability.

## Validation and operating bounds

`node --test tests/dialogue-images.test.mjs` verifies authentication, duplicate
requests, conflict handling and keeping provider credentials out of responses.
The test uses a fake provider and makes no paid API calls.

The service limits concurrent generations to two, provider waiting to 150
seconds and response bodies to 12 MB. Up to eight jobs are held in an in-memory
cache. This cache does not survive a restart or deduplicate across replicas;
the main application must own durable job state and avoid automatic replay
after an uncertain provider result. No database or customer billing keys are
needed by this service.
