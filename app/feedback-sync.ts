export type FeedbackMessageRecord = { id: string; sender: "client" | "admin" | "bot"; body: string; createdAt: string };
export type AnnouncementRecord = { id: string; message: string; createdAt: string };
export type FeedbackSnapshot<T extends FeedbackMessageRecord = FeedbackMessageRecord> = {
  messages: T[];
  announcements: AnnouncementRecord[];
  unreadRepliesCount: number;
  unreadAnnouncementsCount: number;
};

// One request at a time. A hidden tab does no polling, and returning to it
// refreshes immediately. The caller restarts this subscription when opening
// a different view or finishing a send, so an older GET cannot erase a send.
export function startFeedbackSync<T extends FeedbackMessageRecord = FeedbackMessageRecord>(
  onSnapshot: (snapshot: FeedbackSnapshot<T>) => void,
  activeKind: "support" | "news" | null,
  options: { url?: string; markRead?: boolean } = {},
) {
  const url = options.url ?? "/api/feedback";
  let stopped = false;
  let inFlight = false;
  let timer: number | undefined;
  let controller: AbortController | undefined;
  const isVisible = () => document.visibilityState !== "hidden";

  async function refresh() {
    if (stopped || inFlight || !isVisible()) return;
    window.clearTimeout(timer);
    inFlight = true;
    controller = new AbortController();
    const requestController = controller;
    const deadline = window.setTimeout(() => requestController.abort(), 10_000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: requestController.signal,
      });
      if (!response.ok) return;
      const payload = await response.json() as Partial<FeedbackSnapshot<T>>;
      if (stopped || requestController.signal.aborted) return;
      const snapshot: FeedbackSnapshot<T> = {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
        unreadRepliesCount: payload.unreadRepliesCount ?? 0,
        unreadAnnouncementsCount: payload.unreadAnnouncementsCount ?? 0,
      };
      onSnapshot(snapshot);
      const unread = activeKind === "support" ? snapshot.unreadRepliesCount : snapshot.unreadAnnouncementsCount;
      if (options.markRead !== false && activeKind && unread > 0 && isVisible()) {
        await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: activeKind }),
          signal: requestController.signal,
        });
      }
    } catch {
      // Keep the last conversation on transient network errors and retry.
    } finally {
      window.clearTimeout(deadline);
      inFlight = false;
      if (!stopped && isVisible()) {
        timer = window.setTimeout(() => void refresh(), activeKind ? 3_000 : 30_000);
      }
    }
  }

  function onVisibilityChange() {
    if (!isVisible()) window.clearTimeout(timer);
    else void refresh();
  }
  function onFocus() { void refresh(); }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);
  void refresh();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
  };
}
