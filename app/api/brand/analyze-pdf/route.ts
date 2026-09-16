// Counterpart to api/brand/analyze/route.ts: fills the same foundation
// fields, but from an uploaded brand-book PDF instead of a website — for
// brands with no site of their own (site owner: "если у бренда нет сайта,
// только группа или страница в ВК"), a PDF the person already has (a
// design agency's brand book, a one-pager) needs no scraping at all.
//
// multipart/form-data, not JSON: the file itself has to travel somehow,
// and (unlike api/uploads/route.ts, which only ever returns a URL) the
// existing profile draft rides along as one extra "snapshot" field so the
// model gets the same "existing_profile_draft" context analyze/route.ts
// already sends, without a second round trip.

import { readBoundedBody, RequestBodyError } from "../../_lib/request-body";
import { uploadBrandBookPdf, StorageError } from "../../_lib/storage";
import { AiResponseError } from "../../_lib/openai-response";
import { callAiModel } from "../../_lib/ai-router";
import { aiConfigured } from "../../_lib/ai-config";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { isAiRateLimited } from "../../_lib/rate-limit";
import { brandAnalysisInstructions, brandAnalysisSchema, normalizeBrandAnalysisResult, type BrandAnalysisResult } from "../../_lib/brand-analysis";
import pdfParse from "pdf-parse";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  let book: { key: string; fileName: string } | null = null;
  try {
    if (isAiRateLimited(request, "research", 2)) return Response.json({ error: "Слишком много исследований подряд. Подождите минуту и повторите." }, { status: 429 });
    const identity = await workspaceIdentity();

    const bytes = await readBoundedBody(request, MAX_PDF_BYTES + 64 * 1024, 60_000);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Файл не передан." }, { status: 400 });

    let snapshot: Record<string, unknown> = {};
    const snapshotRaw = form.get("snapshot");
    if (typeof snapshotRaw === "string") {
      try { snapshot = JSON.parse(snapshotRaw) as Record<string, unknown>; } catch { snapshot = {}; }
    }
    const existing = {
      name: clean(snapshot.name, 160),
      description: clean(snapshot.description, 1800),
      positioning: clean(snapshot.positioning, 1400),
      audience: clean(snapshot.audience, 1200),
      advantages: clean(snapshot.advantages, 2000),
      products: clean(snapshot.products, 1400),
      services: clean(snapshot.services, 1400),
      proof: clean(snapshot.proof, 1400),
      geography: clean(snapshot.geography, 800),
    };

    const uploaded = await uploadBrandBookPdf(file, identity.email);
    book = { key: uploaded.key, fileName: clean(file.name, 200) || "brandbook.pdf" };

    // Everything past this point only affects auto-fill quality, not
    // whether the file is attached — that already succeeded above. Any
    // failure from here on downgrades to "attached, fill it in yourself"
    // instead of the generic error response, so a flaky AI call or a
    // scanned/image-only PDF never looks like the upload itself failed.
    try {
      let text = "";
      try {
        const parsed = await pdfParse(Buffer.from(uploaded.bytes));
        text = parsed.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      } catch (error) {
        console.error("Brand-book PDF text extraction failed", error instanceof Error ? error.message : error);
      }

      if (text.length < 40) {
        return Response.json({
          mode: "attached_only",
          book,
          result: null,
          note: "Файл прикреплён, но извлечь текст не удалось (похоже, брендбук — набор картинок без текстового слоя). Заполните поля вручную.",
        });
      }

      await assertSecondaryQuotaAvailable("research");
      if (!aiConfigured()) {
        return Response.json({ mode: "attached_only", book, result: null, note: "Файл прикреплён. ИИ пока не подключён — заполните поля вручную." });
      }

      const instructions = brandAnalysisInstructions(
        "Ты — бренд-стратег платформы КЛИО. По содержимому PDF-файла с брендбуком компании собери основу профиля бренда для редакционной команды.",
      );

      const { result, model } = await callAiModel<BrandAnalysisResult>({
        operation: "analyze_brand_website",
        ownerEmail: identity.email,
        schemaName: "klio_brand_analysis",
        schema: brandAnalysisSchema(),
        instructions,
        input: JSON.stringify({
          pdf_file_name: book.fileName,
          // Same 7,000-char bound as the website snapshot in
          // analyze/route.ts — a profile is a compact factual extraction,
          // not a long-form research task.
          pdf_snapshot: text.slice(0, 7_000),
          existing_profile_draft: {
            name: existing.name || null,
            description: existing.description || null,
            positioning: existing.positioning || null,
            audience: existing.audience || null,
            advantages: existing.advantages || null,
            products: existing.products || null,
            services: existing.services || null,
            proof: existing.proof || null,
            geography: existing.geography || null,
          },
        }, null, 2),
      });

      const normalized = normalizeBrandAnalysisResult(result, existing.name);
      if (!normalized.description || !normalized.positioning || !normalized.audience || !normalized.advantages) {
        throw new AiResponseError("КЛИО не смогла собрать основу бренда по этому файлу.");
      }

      const usage = await recordResearch();
      return Response.json({ mode: "ai", model, book, result: normalized, usage });
    } catch (error) {
      console.error("Brand-book auto-fill failed after a successful upload", error instanceof Error ? error.message : error);
      return Response.json({
        mode: "attached_only",
        book,
        result: null,
        note: "Файл прикреплён, но КЛИО не смогла подготовить поля по его содержимому. Заполните их вручную.",
      });
    }
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    console.error("Brand-book upload failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Не удалось загрузить файл. Проверьте его и повторите попытку." }, { status: 500 });
  }
}
