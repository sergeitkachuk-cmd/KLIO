// Optional outbound relay for reaching api.telegram.org, for when the
// direct route from this host is blocked — see the comment on
// postToTelegramApi in social-publish.ts for the full history (IPv6-route
// fix, then Timeweb support's own traceroute confirming the block sits
// outside their infrastructure: DNS resolves api.telegram.org correctly,
// but the TCP handshake to the real, resolved IP times out 100% of the
// time from this host while every other outbound HTTPS call succeeds).
//
// The relay is a plain TCP forwarder on a server outside whatever network
// is blocking the direct path — e.g. `socat TCP-LISTEN:8443,fork,reuseaddr
// TCP:api.telegram.org:443` — not a TLS-terminating proxy: the actual TLS
// handshake below still happens end-to-end with Telegram's real
// certificate (servername stays "api.telegram.org" even though the
// socket connects to the relay's address), so the relay only ever
// forwards opaque encrypted bytes and never sees the bot token or post
// content.
//
// Unset by default (both env vars empty): every caller below connects
// directly to Telegram, byte-for-byte the same as before this existed.
export function telegramConnectTarget(realHostname: string, realPort: number | string): { hostname: string; port: number | string; servername: string } {
  const proxyHost = process.env.TELEGRAM_PROXY_HOST?.trim();
  const proxyPort = process.env.TELEGRAM_PROXY_PORT?.trim();
  if (proxyHost && proxyPort) {
    return { hostname: proxyHost, port: proxyPort, servername: realHostname };
  }
  return { hostname: realHostname, port: realPort, servername: realHostname };
}
