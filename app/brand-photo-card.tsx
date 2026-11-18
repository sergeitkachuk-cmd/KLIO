"use client";

import Image from "next/image";
import { Camera, ArrowUpRight, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function BrandPhotoCard({ name, brandId, photoKey, onChange }: {
  name: string; brandId: string; photoKey: string;
  onChange: (key: string, fileName: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const localUrl = useRef("");
  const [uploaded, setUploaded] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => () => { if (localUrl.current) URL.revokeObjectURL(localUrl.current); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const hasPhoto = Boolean(photoKey && brandId && photoKey !== failedKey);
  async function upload(file: File) {
    if (busy) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError("Выберите JPEG, PNG, WEBP или GIF до 8 МБ."); return;
    }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/brand/photo", { method: "POST", body: form });
      const result = await response.json() as { key?: string; fileName?: string; error?: string };
      if (!response.ok || !result.key) throw new Error(result.error || "Не удалось загрузить фото.");
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      localUrl.current = URL.createObjectURL(file);
      setUploaded({ key: result.key, url: localUrl.current });
      setFailedKey(null); onChange(result.key, result.fileName || file.name);
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось загрузить фото."); }
    finally { setBusy(false); }
  }
  return <article className="brand-photo-card" data-brand-motion>
    <Image src={hasPhoto ? uploaded?.key === photoKey ? uploaded.url : `/api/brand/photo?brandId=${encodeURIComponent(brandId)}&v=${encodeURIComponent(photoKey)}` : "/dialogue/card-photos/ideas.jpg"} alt={hasPhoto ? `Фото бренда ${name}` : "Пример обложки: природный пейзаж"} fill sizes="(max-width:640px) 100vw, 40vw" unoptimized onError={() => { if (hasPhoto) { setFailedKey(photoKey); setError("Не удалось открыть фото. Попробуйте загрузить его снова."); } }}/>
    <div className="brand-photo-top"><span><Camera size={13}/>{hasPhoto ? "ФОТО БРЕНДА" : "ПРИМЕР ОБЛОЖКИ"}</span><ArrowUpRight size={22}/></div>
    <div className="brand-photo-caption"><span>У каждого бренда — своя история.</span><h4>{name || "Ваш бренд"}</h4><button type="button" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15}/>{busy ? "Загружаю…" : hasPhoto ? "Заменить фото" : "Добавить своё фото"}</button>{photoKey && <button className="brand-photo-remove" type="button" disabled={busy} onClick={() => { onChange("", ""); setError(""); }}>Убрать фото</button>}</div>
    <input ref={input} aria-label="Загрузить фото бренда" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }}/>
    {error && <p className="brand-photo-error" role="alert">{error}</p>}
  </article>;
}
