import { readWebsiteContext, websiteSourceLabel } from "../../_lib/website-context";
import { AiNotConfiguredError, AiResponseError, openAiErrorResponse } from "../../_lib/openai-response";
import { callAiModel } from "../../_lib/ai-router";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";

type BrandAnalysisPayload = {
  website?: unknown;
  name?: unknown;
  description?: unknown;
  positioning?: unknown;
  audience?: unknown;
  advantages?: unknown;
};

type BrandAnalysisResult = {
  name: string;
  description: string;
  positioning: string;
  audience: string;
  advantages: string;
};

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePayload(raw: BrandAnalysisPayload) {
  return {
    website: clean(raw.website, 220),
    name: clean(raw.name, 160),
    description: clean(raw.description, 1800),
    positioning: clean(raw.positioning, 1400),
    audience: clean(raw.audience, 1200),
    advantages: clean(raw.advantages, 2000),
  };
}

function analysisSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      positioning: { type: "string" },
      audience: { type: "string" },
      advantages: { type: "string" },
    },
    required: ["name", "description", "positioning", "audience", "advantages"],
    additionalProperties: false,
  } as const;
}

function normalizeResult(result: BrandAnalysisResult, fallbackName: string) {
  return {
    name: clean(result.name, 160) || fallbackName,
    description: clean(result.description, 900),
    positioning: clean(result.positioning, 700),
    audience: clean(result.audience, 700),
    advantages: clean(result.advantages, 1000),
  };
}

export async function POST(request: Request) {
  try {
    const input = normalizePayload(await request.json() as BrandAnalysisPayload);
    if (!input.website) return Response.json({ error: "Укажите сайт бренда, чтобы КЛИО могла его прочитать." }, { status: 400 });

    await assertSecondaryQuotaAvailable("research");
    if (!process.env.OPENAI_API_KEY?.trim()) throw new AiNotConfiguredError();
    const identity = await workspaceIdentity();
    const website = await readWebsiteContext(input.website);
    if (website.status === "blocked") {
      return Response.json({ error: "Этот адрес сайта отклонён проверкой безопасности. Проверьте ссылку и попробуйте снова." }, { status: 400 });
    }

    const instructions = [
      "Ты — бренд-стратег платформы КЛИО. По открытой странице сайта (и, если она недоступна или скудная, по данным из веб‑поиска) собери основу профиля бренда для редакционной команды.",
      "Читай только то, что реально есть на сайте или подтверждено поиском. Не открывай несуществующие разделы, не додумывай функциональность, услуги, цены, даты основания, размер команды, награды, клиентов или показатели.",
      "name — официальное название компании/продукта. Если переданное название уже верное, верни его как есть; уточни только если на сайте оно явно другое.",
      "description — короткая фактическая справка: сфера, география, услуги и масштаб компании. 2–4 предложения, без рекламных эпитетов и превосходных степеней.",
      "positioning — редакционный ориентир: какое место бренд занимает в сознании аудитории. Не рекламный слоган и не список фич, а сжатая формулировка позиционирования в 1–2 предложениях.",
      "audience — кто читатель: с какой задачей и на каком уровне понимания темы приходит к этому бренду. 1–3 предложения, без демографических догадок, которых нет на сайте.",
      "advantages — только подтверждённые особенности и факты со страницы, на которые можно опираться в тексте; каждый факт с новой строки, без нумерации и без слов вроде «лучший» или «номер один», если это не прямая цитата с сайта.",
      "Уже заполненные поля профиля — это черновик пользователя, а не факт: используй их как подсказку о фокусе, но приоритет всегда у того, что подтверждено сайтом или поиском; явно устаревшее или неточное — исправляй.",
      "Если по теме почти ничего не удалось найти, честно пиши только то немногое, что подтверждено, короче — не заполняй пробелы предположениями.",
      "Пиши по-русски, нейтральным деловым тоном, без маркетинговых клише.",
      "Верни только структурированный результат по JSON‑схеме.",
    ].join("\n");

    const { result, model } = await callAiModel<BrandAnalysisResult>({
      operation: "analyze_brand_website",
      ownerEmail: identity.email,
      schemaName: "klio_brand_analysis",
      schema: analysisSchema(),
      instructions,
      input: JSON.stringify({
        requested_website: input.website,
        website_status: website.status,
        website_snapshot: website.status === "loaded" ? { url: website.resolvedUrl, text: website.text } : null,
        existing_profile_draft: {
          name: input.name || null,
          description: input.description || null,
          positioning: input.positioning || null,
          audience: input.audience || null,
          advantages: input.advantages || null,
        },
      }, null, 2),
    });

    const normalized = normalizeResult(result, input.name);
    if (!normalized.description || !normalized.positioning || !normalized.audience || !normalized.advantages) {
      throw new AiResponseError("КЛИО не смогла собрать основу бренда по этому сайту. Проверьте ссылку или заполните поля вручную.", 422);
    }

    const usage = await recordResearch();
    return Response.json({
      result: normalized,
      mode: "ai",
      model,
      sources: { website: website.status, websiteNote: websiteSourceLabel(website) },
      usage,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось проанализировать сайт. Проверьте ссылку и повторите попытку.");
  }
}
