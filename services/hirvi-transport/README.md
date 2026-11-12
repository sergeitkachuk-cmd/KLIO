# Shared Render transport

This deployment keeps the existing KLIO image and original startup command. Stock Caddy routes /_hirvi/ws to authenticated stock GOST; all other requests retain the existing KLIO handlers. OpenClaw state and browser remain on Timeweb.

Build and network qualification run in .github/workflows/hirvi-shared-transport.yml without customer credentials. Rollback image: ghcr.io/sergeitkachuk-cmd/klio-relay:71a48fc0a1d97b587832bac9aa18b44efe62b4b4.
