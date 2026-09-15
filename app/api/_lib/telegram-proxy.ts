// Optional self-hosted Bot API server for reaching Telegram, for when the
// direct route from this host is blocked — see the comment on
// postToTelegramApi in social-publish.ts for the full history (IPv6-route
// fix, then Timeweb support's own traceroute confirming the block sits
// outside their infrastructure, then a plain-TCP-relay attempt that
// reached api.telegram.org but got back a different, redirect-shaped
// response instead of the real API — evidently Telegram's own edge treats
// this differently depending on source IP).
//
// This is Telegram's own answer to exactly that class of problem: run
// https://github.com/tdlib/telegram-bot-api yourself, on a host that can
// actually reach Telegram, and point Bot API calls at it instead of
// api.telegram.org. It speaks the same HTTP interface (same /bot<token>/
// <method> paths, same JSON shapes) but does the real work over MTProto,
// not HTTPS to api.telegram.org — so none of the IPv6-routing or
// edge-redirect issues above apply to it at all. Its local interface has
// no TLS of its own, hence plain http:// here rather than https://.
//
// Unset by default (either env var empty): every caller talks to the
// real https://api.telegram.org, unchanged from before this existed.
export function telegramApiBase(): string {
  const proxyHost = process.env.TELEGRAM_PROXY_HOST?.trim();
  const proxyPort = process.env.TELEGRAM_PROXY_PORT?.trim();
  if (proxyHost && proxyPort) return `http://${proxyHost}:${proxyPort}`;
  return "https://api.telegram.org";
}
