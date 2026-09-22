import { createHash } from "node:crypto";
import { dialogueImageSourceUrl, latestDialogueImage, type DialogueImageSource } from "../../dialogue-image-source";
import { isImageEditRequest } from "../../dialogue-starters";
import type { DialogueData } from "../../dialogue-model";

export class DialogueImageSourceError extends Error {}
export type ResolvedDialogueImageSource = { key: string; url: string; purpose: "edit" | "reference" };

export function resolveDialogueImageSource(raw: unknown, data: DialogueData, text: string, email: string, baseUrl: string): ResolvedDialogueImageSource | undefined {
  let source: DialogueImageSource | null;
  if (raw !== undefined) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DialogueImageSourceError("Выберите исходное изображение.");
    const input = raw as Record<string, unknown>;
    if (!["edit", "reference"].includes(String(input.purpose))
      || (typeof input.cardId === "string") === (typeof input.uploadUrl === "string")
      || (input.slideIndex !== undefined && (!Number.isInteger(input.slideIndex) || Number(input.slideIndex) < 0 || !input.cardId)))
      throw new DialogueImageSourceError("Некорректное исходное изображение.");
    source = input as DialogueImageSource;
  } else {
    if (!isImageEditRequest(text)) return;
    source = latestDialogueImage(data);
  }
  if (!source) throw new DialogueImageSourceError("Нажмите «Доработать» на нужном изображении или загрузите референс.");
  const url = dialogueImageSourceUrl(source, data);
  let parsed: URL;
  try { parsed = new URL(url, baseUrl); } catch { throw new DialogueImageSourceError("Исходное изображение недоступно."); }
  const match = /^\/api\/uploads\/(publications\/([a-f0-9]{64})\/[a-f0-9-]{36}\.(?:png|jpg|webp|gif))$/.exec(parsed.pathname);
  const owner = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  // Never fetch a supplied URL. Only read an owner-scoped key from our own S3.
  if (!/^https?:$/.test(parsed.protocol) || !match || match[2] !== owner)
    throw new DialogueImageSourceError("Выберите своё изображение из диалога или загрузите файл заново.");
  return { key: match[1], url: new URL(`/api/uploads/${match[1]}`, baseUrl).href, purpose: source.purpose };
}
