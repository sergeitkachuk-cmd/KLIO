"use client";

import { useMemo, useState } from "react";

export type AdminFeedbackMessage = {
  id: string;
  ownerEmail: string;
  sender: "client" | "admin" | "bot";
  body: string;
  createdAt: string;
  readAt: string | null;
};

// Every registered customer, not just people who already wrote in - admin
// needs to search up *any* account and message them first (site owner:
// "с возможностью и мне писать им лично, а не только в ответ").
export type AdminFeedbackAccount = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

type Thread = {
  ownerEmail: string;
  displayName: string;
  avatarUrl: string | null;
  messages: AdminFeedbackMessage[];
  lastAt: string;
  needsReply: boolean;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function senderLabel(sender: AdminFeedbackMessage["sender"]): string {
  if (sender === "client") return "Клиент";
  if (sender === "bot") return "КЛИО (бот)";
  return "Вы";
}

// Same two-initial fallback as admin-users-table.tsx's own initials() -
// duplicated rather than imported, this file has no existing pattern of
// pulling from that module (see the BrandProfile mirror comment there).
function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((item) => item[0]?.toLocaleUpperCase("ru-RU") || "").join("") || "?").slice(0, 2);
}

function Avatar({ label, avatarUrl }: { label: string; avatarUrl: string | null | undefined }) {
  return (
    <span className="admin-avatar-circle">
      {avatarUrl
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host (own /api/admin/account-avatar, or Yandex's/VK's own CDN) - not worth a next.config.ts remotePatterns entry for two different providers
        ? <img src={avatarUrl} alt="" />
        : initials(label)}
    </span>
  );
}

// One entry per known account, merged with whatever messages it already
// has (if any) - not one entry per thread that already exists, so admin
// can find and open a never-contacted account from the left column too,
// same as picking a contact rather than only ever replying to an inbox.
function buildThreads(rows: AdminFeedbackMessage[], accounts: AdminFeedbackAccount[]): Thread[] {
  const byOwner = new Map<string, AdminFeedbackMessage[]>();
  for (const row of rows) {
    const list = byOwner.get(row.ownerEmail);
    if (list) list.push(row); else byOwner.set(row.ownerEmail, [row]);
  }
  const accountByEmail = new Map(accounts.map((item) => [item.email, item]));
  // A row's ownerEmail should always be a known account, but stay
  // defensive - fall back to the email itself rather than dropping a real
  // conversation if the two lists ever disagree.
  const emails = new Set([...accountByEmail.keys(), ...byOwner.keys()]);

  const threads: Thread[] = [];
  for (const email of emails) {
    const messages = byOwner.get(email) ?? [];
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // needsReply skips bot rows on purpose - the bot always answers a
    // client message immediately (see api/feedback/route.ts's
    // BOT_ACK_MESSAGE), so "last message is from the bot" must not read as
    // "already answered".
    const lastNonBot = [...messages].reverse().find((item) => item.sender !== "bot");
    const account = accountByEmail.get(email);
    threads.push({
      ownerEmail: email,
      displayName: account?.displayName || email,
      avatarUrl: account?.avatarUrl ?? null,
      messages,
      lastAt: messages.length ? messages[messages.length - 1].createdAt : "",
      needsReply: lastNonBot?.sender === "client",
    });
  }
  // Active conversations first (most recent on top, Telegram-style);
  // never-contacted accounts after, alphabetically - there to be found by
  // search when starting a new one, not to flood the default chat list.
  threads.sort((a, b) => {
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt || b.lastAt) return a.lastAt ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, "ru-RU");
  });
  return threads;
}

function ThreadPane({ thread }: { thread: Thread }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<AdminFeedbackMessage[]>([]);

  async function send() {
    const reply = draft.trim();
    if (!reply) {
      setError("Введите текст сообщения.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail: thread.ownerEmail, reply }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось отправить сообщение.");
      if (payload.feedback) setSent((current) => [...current, payload.feedback]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить сообщение.");
    } finally {
      setBusy(false);
    }
  }

  const messages = [...thread.messages, ...sent];

  return (
    <div className="admin-feedback-thread">
      <div className="admin-feedback-thread-head">
        <Avatar label={thread.displayName} avatarUrl={thread.avatarUrl} />
        <span>
          <b>{thread.displayName}</b>
          <small>{thread.ownerEmail}</small>
        </span>
      </div>
      <div className="admin-feedback-bubbles">
        {messages.length === 0 && <p className="admin-feedback-empty-thread">Переписки ещё нет — напишите первое сообщение.</p>}
        {messages.map((item) => (
          <div key={item.id} className={`admin-feedback-bubble-row is-${item.sender}`}>
            {item.sender === "client" && <Avatar label={thread.displayName} avatarUrl={thread.avatarUrl} />}
            <div className={`admin-feedback-bubble is-${item.sender}`}>
              <span className="admin-feedback-bubble-sender">{senderLabel(item.sender)}</span>
              <p>{item.body}</p>
              <time>{formatDateTime(item.createdAt)}</time>
            </div>
          </div>
        ))}
      </div>
      <div className="admin-feedback-reply">
        <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Введите сообщение…" />
        <div className="admin-feedback-reply-actions">
          <button type="button" className="admin-details-toggle" disabled={busy} onClick={() => void send()}>{busy ? "Отправляем…" : "Отправить"}</button>
        </div>
        {error && <p className="admin-feedback-reply-error">{error}</p>}
      </div>
    </div>
  );
}

type Props = { rows: AdminFeedbackMessage[]; accounts: AdminFeedbackAccount[] };

export function AdminFeedbackTable({ rows, accounts }: Props) {
  const threads = useMemo(() => buildThreads(rows, accounts), [rows, accounts]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const filteredThreads = useMemo(() => {
    if (!normalizedQuery) return threads;
    return threads.filter((item) => [item.ownerEmail, item.displayName].some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  }, [normalizedQuery, threads]);

  const activeEmail = selected && threads.some((item) => item.ownerEmail === selected) ? selected : (threads[0]?.ownerEmail ?? null);
  const activeThread = threads.find((item) => item.ownerEmail === activeEmail) ?? null;

  if (!threads.length) {
    return <p className="admin-empty-row">Клиентов пока нет.</p>;
  }

  return (
    <div className="admin-feedback-layout">
      <div className="admin-feedback-thread-panel">
        <input
          type="search"
          className="admin-feedback-thread-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени или почте"
        />
        <div className="admin-feedback-thread-list">
          {filteredThreads.map((thread) => {
            const last = thread.messages[thread.messages.length - 1];
            return (
              <button
                type="button"
                key={thread.ownerEmail}
                className={`admin-feedback-thread-item ${thread.ownerEmail === activeEmail ? "active" : ""}`}
                onClick={() => setSelected(thread.ownerEmail)}
              >
                <Avatar label={thread.displayName} avatarUrl={thread.avatarUrl} />
                <span className="admin-feedback-thread-item-text">
                  <span className="admin-feedback-thread-item-email">{thread.displayName}</span>
                  <span className="admin-feedback-thread-item-preview">{last ? last.body : "Переписки ещё нет"}</span>
                  <span className="admin-feedback-thread-item-meta">
                    {last && <time>{formatDateTime(thread.lastAt)}</time>}
                    {thread.needsReply && <em className="admin-badge-attention admin-badge-attention-inline">ждёт ответа</em>}
                  </span>
                </span>
              </button>
            );
          })}
          {!filteredThreads.length && <p className="admin-empty-row">Никого не нашли.</p>}
        </div>
      </div>
      {activeThread && <ThreadPane thread={activeThread} key={activeThread.ownerEmail} />}
    </div>
  );
}
