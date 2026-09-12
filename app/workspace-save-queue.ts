// One mounted cabinet must finish each snapshot before sending the next.
// A failed save must not poison subsequent explicit retries.
export function createWorkspaceSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(save: () => Promise<T>): Promise<T> {
    const result = tail.then(save);
    tail = result.catch(() => undefined);
    return result;
  };
}
