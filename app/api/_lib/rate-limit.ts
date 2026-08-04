// In-memory, single-instance rate limiter. KLIO's web service runs with
// WEB_CONCURRENCY=1 on Render, so a module-level Map is a real (if modest)
// speed bump against signup/login bots — not a distributed solution, but
// cheap defense-in-depth alongside email verification.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Bounds unbounded growth from spoofed/varying IPs; buckets are tiny.
const MAX_TRACKED_KEYS = 5000;

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
