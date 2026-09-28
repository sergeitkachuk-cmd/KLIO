"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// The circle itself (image or initials) plus its own upload/remove
// controls - a client component because file upload needs an <input> and
// fetch(), unlike the rest of /account/page.tsx (a server component). Own
// upload always wins over an auto-captured Yandex/VK photo - see
// accountSummary()'s own comment for why - so "Удалить фото" only ever
// removes the custom one and falls back to whichever of those two this
// account actually has, never to bare initials while a provider photo is
// still available.
export function AccountAvatar({ initials, avatarUrl, hasCustomAvatar }: { initials: string; avatarUrl: string | null; hasCustomAvatar: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/account/avatar", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить фото.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить фото.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/avatar", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось открепить фото.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось открепить фото.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-avatar">
      <i className="account-avatar-circle">
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external host (own /api/account/avatar, or Yandex's/VK's own CDN) */}
        {avatarUrl ? <img src={avatarUrl} alt="" /> : initials}
      </i>
      <div className="account-avatar-actions">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }} />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Секунду…" : "Изменить фото"}</button>
        {hasCustomAvatar && <button type="button" className="account-avatar-remove" disabled={busy} onClick={() => void remove()}>Удалить фото</button>}
      </div>
      {error && <small className="account-avatar-error" role="alert">{error}</small>}
    </div>
  );
}
