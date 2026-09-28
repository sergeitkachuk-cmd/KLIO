"use client";

import type { ReactNode } from "react";
import { sameCard, type DialogueCard } from "./dialogue-model";

export function imageDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    // Images generated on the main domain also download through this stand's
    // own storage route. Avoid cross-origin `download` being ignored by browsers.
    if (/^\/api\/uploads\/publications\/[a-f0-9]{64}\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(url.pathname)) {
      return `${url.pathname}?download=1`;
    }
    return url.href;
  } catch { return ""; }
}

// Same paths as textora-experience.tsx's own shared Icon() component
// (not imported from there - that one is a private, unexported function
// local to that file, and this component lives in its own module).
const DOWNLOAD_ICON_PATH = <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>;
const EDIT_ICON_PATH = <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>;
function ActionIcon({ path }: { path: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

export function DialogueResultActions({ card, pureImage, busy, onAction, error, notice }: {
  card: DialogueCard;
  pureImage: boolean;
  busy: boolean;
  onAction: (type: string) => void;
  error?: string;
  notice?: string;
}) {
  const downloadUrl = card.imageUrl ? imageDownloadUrl(card.imageUrl) : "";
  const saved = Boolean(card.savedId && card.savedSnapshot && sameCard(card, card.savedSnapshot));
  const action = (type: string, label: string, disabled = false) => <button key={type} type="button" data-action={type} disabled={busy || disabled} onClick={() => onAction(type)}>{label}</button>;
  // Only the two image-specific actions become icon-only circles (site
  // owner: "значками действия с картинками... компактнее") - the rest of
  // this list (save/publish/copy/topic actions) applies to text materials
  // too and stays as labelled pills, not scoped to "actions with images".
  return <div className="klio-result-actions" aria-busy={busy}>
    <div className="klio-result-actions-buttons">
      {downloadUrl && !card.slides?.length && <a className="klio-result-action-icon" href={downloadUrl} download rel="noopener noreferrer" aria-label="Скачать изображение" title="Скачать изображение"><ActionIcon path={DOWNLOAD_ICON_PATH}/></a>}
      {downloadUrl && !card.slides?.length && <button type="button" className="klio-result-action-icon" data-action="klio.refine_image" disabled={busy} onClick={() => onAction("klio.refine_image")} aria-label="Доработать изображение" title="Доработать изображение"><ActionIcon path={EDIT_ICON_PATH}/></button>}
      {!pureImage && action("klio.copy", "Копировать текст")}
      {action("klio.save", saved ? "Сохранено в материалах" : card.savedId ? "Обновить материал" : "В материалы", saved)}
      {(pureImage || card.kind !== "topic") && action("klio.publish", "В публикацию")}
      {!pureImage && card.kind === "topic" && <>
        {action("klio.topic_post", "Написать пост")}
        {action("klio.topic_article", "Написать статью")}
        {action("klio.topic_generator", "В генератор")}
      </>}
      {!pureImage && action("klio.image", "Создать картинку")}
      {!pureImage && action("klio.edit", "Редактировать")}
    </div>
    {error && <p className="klio-result-action-error" role="alert">{error}</p>}
    {!error && notice && <p role="status">{notice}</p>}
  </div>;
}
