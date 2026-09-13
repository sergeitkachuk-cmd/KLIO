// In-memory, per-process defense in depth. Counters are not shared between
// replicas and reset on restart; this is not a distributed rate limiter.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Bounds unbounded growth from spoofed/varying IPs; buckets are tiny.
const MAX_TRACKED_KEYS = 5000;

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    // Evict only entries that have actually expired, oldest first — a full
    // buckets.clear() here would let an attacker who inflates the map past
    // MAX_TRACKED_KEYS (e.g. by cycling spoofed IPs) reset every other
    // key's counter, including their own, defeating the throttle.
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [trackedKey, trackedBucket] of buckets) {
        if (trackedBucket.resetAt <= now) buckets.delete(trackedKey);
      }
      // Never evict an active counter: flooding new keys must not reset
      // an existing caller's allowance. Deny new keys until space expires.
      if (buckets.size >= MAX_TRACKED_KEYS) return true;
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count = Math.min(bucket.count + 1, limit + 1);
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
