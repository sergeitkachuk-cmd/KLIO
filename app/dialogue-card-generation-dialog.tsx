"use client";

import { useState } from "react";
import { DialogueModal } from "./dialogue-modal";
import { FORMAT_OPTIONS, TONE_OPTIONS, LENGTH_OPTIONS, TEXT_LENGTH_TARGETS, IMAGE_ASPECT_OPTIONS, IMAGE_FORMAT_OPTIONS, type GenerationSettings } from "./dialogue-generation-settings";
import { CARD_IMAGE_STYLES, type CardGenerationChoices, type CardGenerationKind } from "./dialogue-card-generation";

export function DialogueCardGenerationDialog({ kind, title, initial, brandName, hasBrand, hasLogo, remaining, onClose, onSubmit }: {
  kind: CardGenerationKind;
  title: string;
  initial: CardGenerationChoices;
  brandName: string;
  hasBrand: boolean;
  hasLogo: boolean;
  remaining: number;
  onClose: () => void;
  onSubmit: (choices: CardGenerationChoices) => Promise<boolean>;
}) {
  const [choices, setChoices] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof GenerationSettings, value: string | boolean) => setChoices(current => ({ ...current, settings: { ...current.settings, [key]: value } }));
  const image = kind === "image";
  const group = (label: string, key: keyof GenerationSettings, options: { value: string; label: string }[]) => <fieldset>
    <legend>{label}</legend>
    <div className="klio-card-generation-choices">{options.map(option => <button type="button" key={option.value} disabled={busy} aria-pressed={choices.settings[key] === option.value} onClick={() => update(key, option.value)}>{option.label}</button>)}</div>
  </fieldset>;
  return <DialogueModal title={image ? "Создать изображение" : "Создать текст"} busy={busy} onClose={onClose}>
    <form className="klio-card-generation" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError("");
      try { await onSubmit(choices); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось начать генерацию. Попробуйте ещё раз."); }
      finally { setBusy(false); }
    }}>
      <p className="klio-card-generation-source">{title}</p>
      {image ? <>
        <fieldset><legend>Стиль изображения</legend><div className="klio-card-generation-choices">{CARD_IMAGE_STYLES.map(style => <button type="button" key={style.value} disabled={busy} aria-pressed={(choices.imageStyle || "") === style.value} onClick={() => setChoices(current => ({ ...current, imageStyle: style.value }))}>{style.label}</button>)}</div></fieldset>
        {group("Ориентация", "imageAspectRatio", IMAGE_ASPECT_OPTIONS)}
        {group("Формат файла", "imageOutputFormat", IMAGE_FORMAT_OPTIONS)}
      </> : <>
        {group("Формат", "format", FORMAT_OPTIONS.filter(option => option.value))}
        {group("Объём", "length", LENGTH_OPTIONS.filter(option => option.value).map(option => ({ ...option, label: `${option.label} · ≈ ${TEXT_LENGTH_TARGETS[option.value]} зн.` })))}
        <label className="klio-card-generation-tone">Стиль
          <select value={choices.settings.tone} disabled={busy} onChange={event => update("tone", event.target.value)}>
            {TONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.value ? option.label : choices.useBrandContext && hasBrand ? "По голосу бренда" : "Нейтральный"}</option>)}
          </select>
        </label>
      </>}
      <label className="klio-card-generation-check"><input type="checkbox" disabled={busy || !hasBrand} checked={hasBrand && choices.useBrandContext} onChange={event => setChoices(current => ({ ...current, useBrandContext: event.target.checked }))} /><span>Использовать профиль бренда<small>{hasBrand ? brandName : "Бренд не выбран — можно создать без него"}</small></span></label>
      {image && <label className="klio-card-generation-check"><input type="checkbox" checked={hasLogo && choices.settings.useLogo} disabled={busy || !hasLogo} onChange={event => update("useLogo", event.target.checked)} /><span>Добавить логотип<small>{hasLogo ? "Из профиля выбранного бренда" : "Логотип можно загрузить в «Мой бизнес»"}</small></span></label>}
      <p className="klio-card-generation-quota">1 материал из лимита · осталось {remaining}</p>
      {error && <p className="klio-card-generation-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" className="klio-card-generation-submit" disabled={busy || remaining <= 0}>{busy ? "Запускаем…" : image ? "Создать изображение" : "Создать текст"}</button></footer>
    </form>
  </DialogueModal>;
}
