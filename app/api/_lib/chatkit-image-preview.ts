import sharp from "sharp";
import { publicationImageHeader } from "./storage";
import type { DialogueThread } from "../../dialogue-model";

type Dimensions = { width: number; height: number };
const cache = new Map<string, { value: Dimensions | null; expires: number }>();
const pending = new Map<string, Promise<Dimensions | null>>();

async function dimensions(url: string, signal: AbortSignal): Promise<Dimensions | null> {
  let key: string;
  try {
    const path = new URL(url).pathname;
    if (!/^\/api\/uploads\/publications\/[a-f0-9]{64}\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(path)) return null;
    key = path.slice("/api/uploads/".length);
  } catch { return null; }
  // Only read our fixed S3 bucket. Never fetch a card's arbitrary URL.
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    let value: Dimensions | null = null;
    try {
      const metadata = await sharp(await publicationImageHeader(key, signal)).metadata();
      if (metadata.width && metadata.height) {
        const rotated = (metadata.orientation || 1) >= 5;
        value = { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height };
      }
    } catch { /* A missing thumbnail must not break conversation history. */ }
    cache.delete(key);
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + (value ? 86400000 : 30000) });
    return value;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

export async function imagePreviewSizes(thread: DialogueThread) {
  const urls = [...new Set(thread.data.cards.map((card) => card.imageUrl).filter(Boolean))];
  const sizes = new Map<string, Dimensions>();
  if (!urls.length) return sizes;
  const signal = AbortSignal.timeout(3000);
  let cursor = 0;
  // One deadline and four reads at most, including legacy images lacking metadata.
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (cursor < urls.length && !signal.aborted) {
      const url = urls[cursor++];
      const size = await dimensions(url, signal);
      if (size) sizes.set(url, size);
    }
  }));
  return sizes;
}
