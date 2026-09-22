import type { DialogueThread } from "./dialogue-model";

type Snapshot = {
  thread: DialogueThread | null;
  selectedId: string | null;
  loading: boolean;
  sending: boolean;
  error: string;
  draft: string;
  view: number;
};
type SendOptions = { mode: string; cardId?: string; useBrandContext: boolean; settings: Record<string, unknown> };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export async function dialogueRequest<T>(values: Record<string, unknown> | string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(typeof values === "string" ? values : "/api/dialogue", {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(typeof values === "string" ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить действие. Попробуйте ещё раз.");
    return payload as T;
  } catch (error) {
    if (controller.signal.aborted || error instanceof TypeError) throw new Error("Не удалось связаться с сервером. Текст сохранён — проверьте соединение и повторите действие.");
    throw error;
  } finally { clearTimeout(timeout); }
}

// The server owns jobs, history and quota accounting. This store only submits
// once and polls reads; reconnecting must never start another paid generation.
export function createDialogueSession(options: {
  brandId: string | null;
  storageKey: string;
  storage?: () => StorageLike;
  request?: typeof dialogueRequest;
  onChange?: () => void;
  pollMs?: number;
}) {
  const request = options.request || dialogueRequest;
  let state: Snapshot = { thread: null, selectedId: null, loading: true, sending: false, error: "", draft: "", view: 0 };
  const initial = state;
  const listeners = new Set<() => void>();
  let epoch = 0;
  let live = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let creating = "";
  let pending: { signature: string; id: string } | null = null;
  const storage = () => options.storage ? options.storage() : localStorage;
  function read(key: string) { try { return storage().getItem(key) || ""; } catch { return ""; } }
  function write(key: string, value: string) { try { if (value) storage().setItem(key, value); else storage().removeItem(key); } catch { /* Optional browser cache. */ } }
  const draftKey = (id = state.selectedId) => `${options.storageKey}:${id || "new"}:draft`;
  const pendingKey = (id = state.selectedId) => `${options.storageKey}:${id || "new"}:pending`;
  function readPending() {
    try {
      const value = JSON.parse(read(pendingKey()));
      return typeof value?.signature === "string" && typeof value?.id === "string" ? value as NonNullable<typeof pending> : null;
    } catch { return null; }
  }
  function update(change: Partial<Snapshot>) { state = { ...state, ...change }; listeners.forEach((fn) => fn()); }
  function validate(thread: DialogueThread) {
    if (!thread?.id || (thread.brandId || null) !== (options.brandId || null) || !Array.isArray(thread.data?.messages) || !Array.isArray(thread.data?.cards))
      throw new Error("Диалог недоступен в выбранном пространстве.");
    return thread;
  }
  function schedule() {
    clearTimeout(timer);
    if (live && state.thread?.status === "processing") timer = setTimeout(() => { void refresh(); }, options.pollMs ?? 1500);
  }
  function accept(thread: DialogueThread) {
    validate(thread);
    if (thread.id !== state.selectedId || (state.thread && thread.revision < state.thread.revision)) return;
    const changed = state.thread?.revision !== thread.revision || state.thread?.status !== thread.status;
    update({ thread, loading: false, error: "" });
    const submitted = pending || readPending();
    if (submitted && thread.data.messages.some((message) => message.id === submitted.id)) {
      try { if (JSON.parse(submitted.signature).text === state.draft) setDraft(""); } catch { /* Invalid optional cache. */ }
      pending = null; write(pendingKey(), "");
    }
    if (changed) options.onChange?.();
    schedule();
  }
  async function refresh() {
    const id = state.selectedId;
    const ticket = epoch;
    if (!id) return;
    try {
      const result = await request<{ thread: DialogueThread }>(`/api/dialogue?id=${encodeURIComponent(id)}`);
      if (live && ticket === epoch) accept(result.thread);
    } catch (error) {
      if (live && ticket === epoch) {
        update({ loading: false, error: error instanceof Error ? error.message : "Не удалось обновить диалог. Сообщения сохранены." });
        // A network outage preserves the accepted job and its request id.
        clearTimeout(timer);
        if (state.thread?.status === "processing") timer = setTimeout(() => { void refresh(); }, 5000);
      }
    }
  }
  async function open(id: string | null) {
    if (state.sending) return;
    epoch++; clearTimeout(timer); pending = null; creating = "";
    write(options.storageKey, id || "");
    update({ selectedId: id, thread: null, loading: Boolean(id), error: "", draft: read(draftKey(id)), view: state.view + 1 });
    if (id) await refresh();
  }
  async function ensureThread(ticket = epoch) {
    if (state.loading) throw new Error("Дождитесь загрузки диалога.");
    if (state.thread) return state.thread;
    if (state.selectedId) throw new Error("Сначала повторите загрузку диалога.");
    creating ||= read(`${options.storageKey}:creating`) || crypto.randomUUID();
    write(`${options.storageKey}:creating`, creating);
    const result = await request<{ thread: DialogueThread }>({ action: "create", id: creating, brandId: options.brandId });
    if (!live || ticket !== epoch) throw new Error("Открыт другой диалог.");
    validate(result.thread);
    write(options.storageKey, result.thread.id);
    write(`${options.storageKey}:creating`, "");
    write(draftKey(result.thread.id), state.draft);
    write(draftKey(null), "");
    update({ selectedId: result.thread.id });
    accept(result.thread);
    return result.thread;
  }
  function setDraft(draft: string) { if (draft !== state.draft) { write(draftKey(), draft); update({ draft }); } }
  async function send(text: string, sendOptions: SendOptions, before?: () => Promise<boolean>) {
    if (state.sending || state.loading || state.thread?.status === "processing" || !text.trim()) return false;
    const ticket = epoch;
    const originalDraft = state.draft;
    update({ sending: true, error: "" });
    try {
      if (before && !await before()) throw new Error("Не удалось сохранить профиль бренда. Проверьте изменения в «Мой бизнес» и повторите запрос.");
      if (!live || ticket !== epoch) return false;
      const thread = await ensureThread(ticket);
      const signature = JSON.stringify({ text, ...sendOptions });
      pending ||= readPending();
      if (pending?.signature !== signature) pending = { signature, id: crypto.randomUUID() };
      write(pendingKey(), JSON.stringify(pending));
      const requestId = pending.id;
      let result: { thread: DialogueThread };
      try {
        result = await request({ action: "send", id: thread.id, revision: thread.revision, requestId, text, ...sendOptions });
      } catch (error) {
        // A disconnected POST can have succeeded. Reconcile by reading the
        // saved user message before offering a retry with the SAME request id.
        const recovered = await request<{ thread: DialogueThread }>(`/api/dialogue?id=${encodeURIComponent(thread.id)}`).catch(() => null);
        if (!recovered?.thread.data.messages.some((message) => message.id === requestId)) {
          if (live && ticket === epoch && recovered) accept(recovered.thread);
          throw error;
        }
        result = recovered;
      }
      if (!live || ticket !== epoch) return false;
      accept(result.thread);
      pending = null;
      write(pendingKey(), "");
      if (state.draft === originalDraft && originalDraft.trim() === text.trim()) setDraft("");
      return true;
    } catch (error) {
      if (live && ticket === epoch) update({ error: error instanceof Error ? error.message : "Не удалось отправить сообщение. Текст сохранён." });
      return false;
    } finally { if (live && ticket === epoch) update({ sending: false }); }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    start() { live = true; update({ sending: false }); void open(read(options.storageKey) || null); },
    stop() { live = false; epoch++; clearTimeout(timer); },
    open, refresh, ensureThread, accept, send, setDraft,
  };
}
export type DialogueSession = ReturnType<typeof createDialogueSession>;
