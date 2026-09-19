function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, ms);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export async function waitForPaymentConfirmation(paymentLinkId: string, options: {
  signal: AbortSignal;
  fetcher?: typeof fetch;
  delay?: typeof pause;
}) {
  const fetcher = options.fetcher || fetch;
  const delay = options.delay || pause;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]);
  for (let attempt = 0; attempt < 20; attempt++) {
    signal.throwIfAborted();
    const response = await fetcher("/api/payments/tochka/reconcile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentLinkId }), signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Не удалось проверить оплату.");
    if (["paid", "refunded", "expired"].includes(body.status)) return body.status as string;
    if (attempt < 19) await delay(3000, signal);
  }
  return "pending";
}
