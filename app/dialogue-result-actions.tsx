"use client";

import type { DialogueCard } from "./dialogue-model";

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

export function DialogueResultActions({ card, pureImage, busy, onAction, error, notice }: {
  card: DialogueCard;
  pureImage: boolean;
  busy: boolean;
  onAction: (type: string) => void;
  error?: string;
  notice?: string;
}) {
  const downloadUrl = card.imageUrl ? imageDownloadUrl(card.imageUrl) : "";
  const action = (type: string, label: string, disabled = false) => <button key={type} type="button" data-action={type} disabled={busy || disabled} onClick={() => onAction(type)}>{label}</button>;
  return <div className="klio-result-actions" aria-busy={busy}>
    <div className="klio-result-actions-buttons">
      {downloadUrl && <a href={downloadUrl} download rel="noopener noreferrer">Скачать изображение</a>}
      {!pureImage && action("klio.copy", "Копировать текст")}
      {action("klio.save", card.savedId ? "Сохранено в материалах" : "В материалы", Boolean(card.savedId))}
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
