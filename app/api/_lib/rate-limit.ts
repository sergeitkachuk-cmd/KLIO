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
    // Evict only entries that have actually expired, oldest first — a full
    // buckets.clear() here would let an attacker who inflates the map past
    // MAX_TRACKED_KEYS (e.g. by cycling spoofed IPs) reset every other
    // key's counter, including their own, defeating the throttle.
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [trackedKey, trackedBucket] of buckets) {
        if (trackedBucket.resetAt < now) buckets.delete(trackedKey);
      }
      // Still full after clearing expired entries (all buckets legitimately
      // live): drop the oldest one rather than every one.
      if (buckets.size >= MAX_TRACKED_KEYS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

export function clientIp(request: Request): string {
  // Render's edge proxy appends the real client IP as the last hop of
  // X-Forwarded-For (any value the client itself sent arrives before it).
  // Keying on the first entry would let a caller pick its own rate-limit
  // bucket by sending a fabricated header.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// Expensive AI operations share one small in-memory guard. It is deliberately
// conservative: normal work remains available, while accidental double-clicks
// and runaway browser retries cannot fan out into many billed provider calls.
export function isAiRateLimited(request: Request, scope: string, limit: number, windowMs = 60_000): boolean {
  return isRateLimited(`ai:${scope}:${clientIp(request)}`, limit, windowMs);
}
