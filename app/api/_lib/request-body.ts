export class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readBoundedBody(request: Request, maxBytes: number, timeoutMs = 10_000): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RequestBodyError("Запрос слишком большой.", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequestBodyError("Истекло время загрузки запроса.", 408));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new RequestBodyError("Запрос слишком большой.", 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
