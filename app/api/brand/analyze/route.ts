import { readWebsiteContext, websiteSourceLabel } from "../../_lib/website-context";
import { extractTavilyWebsite } from "../../_lib/tavily";
import { CORE_SYSTEM_RULES } from "../../../content-plans";
import { AiNotConfiguredError, AiResponseError, openAiErrorResponse } from "../../_lib/openai-response";
import { callAiModel } from "../../_lib/ai-router";
import { aiConfigured } from "../../_lib/ai-config";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { isAiRateLimited } from "../../_lib/rate-limit";

type BrandAnalysisPayload = {
  website?: unknown;
  name?: unknown;
  description?: unknown;
  positioning?: unknown;
  audience?: unknown;
  advantages?: unknown;
  products?: unknown;
  services?: unknown;
  proof?: unknown;
  geography?: unknown;
};

type BrandAnalysisResult = {
  name: string;
  description: string;
  positioning: string;
  audience: string;
  advantages: string;
  products: string;
  services: string;
  proof: string;
  geography: string;
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
    products: clean(raw.products, 1400),
    services: clean(raw.services, 1400),
    proof: clean(raw.proof, 1400),
    geography: clean(raw.geography, 800),
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
      products: { type: "string" },
      services: { type: "string" },
      proof: { type: "string" },
      geography: { type: "string" },
    },
    required: ["name", "description", "positioning", "audience", "advantages", "products", "services", "proof", "geography"],
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
    products: clean(result.products, 700),
    services: clean(result.services, 700),
    proof: clean(result.proof, 700),
    geography: clean(result.geography, 400),
  };
}

export async function POST(request: Request) {
  try {
    if (isAiRateLimited(request, "research", 2)) return Response.json({ error: "Слишком много исследований подряд. Подождите минуту и повторите." }, { status: 429 });
    const input = normalizePayload(await request.json() as BrandAnalysisPayload);
    if (!input.website) return Response.json({ error: "Укажите сайт бренда, чтобы КЛИО могла его прочитать." }, { status: 400 });

    await assertSecondaryQuotaAvailable("research");
    if (!aiConfigured()) throw new AiNotConfiguredError();
    const [identity, website] = await Promise.all([workspaceIdentity(), readWebsiteContext(input.website)]);
    if (website.status === "blocked") {
      return Response.json({ error: "Этот адрес сайта отклонён проверкой безопасности. Проверьте ссылку и попробуйте снова." }, { status: 400 });
    }
    // The direct read is fast and free. Tavily Extract is a single bounded
    // fallback for SPAs or protected pages; DeepSeek never searches itself.
    const tavilyWebsite = website.status === "loaded" ? null : await extractTavilyWebsite(input.website);

    const instructions = [
      "Ты — бренд-стратег платформы КЛИО. По открытой странице сайта (и, если она недоступна или скудная, по данным из веб‑поиска) собери основу профиля бренда для редакционной команды.",
      ...CORE_SYSTEM_RULES,
      "Работай как фактчекинговый редактор: внутренне различай прямые подтверждённые факты, осторожные редакционные гипотезы и отсутствующие сведения. Во внешний ответ текущей схемы включай только подтверждённое; интерпретацию формулируй осторожно и никогда не выдавай её за факт.",
      "Читай только то, что реально есть на сайте или подтверждено поиском. Не открывай несуществующие разделы, не додумывай функциональность, услуги, цены, даты основания, размер команды, награды, клиентов или показатели.",
      "Не выдумывай продукты, услуги, доказательства, географию, голос, словарь, CTA, подпись, юридический статус или целевую аудиторию. Если данные скудны, используй только подтверждённую нейтральную формулировку, а не маркетинговый шаблон.",
      "name — официальное название компании/продукта. Если переданное название уже верное, верни его как есть; уточни только если на сайте оно явно другое.",
      "description — короткая фактическая справка: сфера, география, услуги и масштаб компании. 2–4 предложения, без рекламных эпитетов и превосходных степеней.",
      "positioning — редакционный ориентир: какое место бренд занимает в сознании аудитории. Не рекламный слоган и не список фич, а сжатая формулировка позиционирования в 1–2 предложениях. Если это лишь вывод из материалов, обозначай его осторожно без превосходства.",
      "audience — кто читатель: с какой задачей и на каком уровне понимания темы приходит к этому бренду. 1–3 предложения, без демографических догадок, которых нет на сайте.",
      "advantages — только подтверждённые особенности и факты со страницы, на которые можно опираться в тексте; каждый факт с новой строки, без нумерации и без слов вроде «лучший» или «номер один», если это не прямая цитата с сайта.",
      "products — конкретные продукты, тарифы или программы бренда по факту сайта; без общих слов вроде «широкий ассортимент», если нет конкретики.",
      "services — что компания реально делает для аудитории: перечень услуг по факту сайта, без домыслов о том, чего на сайте нет.",
      "proof — только реально подтверждённые основания доверия: документы, лицензии, сертификаты, конкретные условия программ, исследования, цифры с самого сайта. Если ничего подобного на сайте нет — верни пустую строку, не придумывай и не обобщай в духе «команда профессионалов».",
      "geography — рынок и территория работы бренда (не путать с географией поискового спроса): город, регион, страна или формат (полностью онлайн). Если на сайте не указано — верни пустую строку.",
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
        // A profile is a compact factual extraction, not a long-form
        // research task. A bounded first-page digest keeps latency stable
        // and leaves enough output room for all structured fields.
        website_snapshot: website.status === "loaded"
          ? { url: website.resolvedUrl, text: website.text.slice(0, 7_000) }
          : tavilyWebsite ? { url: tavilyWebsite.url, text: tavilyWebsite.content.slice(0, 7_000) } : null,
        existing_profile_draft: {
          name: input.name || null,
          description: input.description || null,
          positioning: input.positioning || null,
          audience: input.audience || null,
          advantages: input.advantages || null,
          products: input.products || null,
          services: input.services || null,
          proof: input.proof || null,
          geography: input.geography || null,
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
      sources: { website: tavilyWebsite ? "tavily_extract" : website.status, websiteNote: tavilyWebsite ? `страница прочитана через Tavily: ${tavilyWebsite.url}` : websiteSourceLabel(website) },
      usage,
    });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось проанализировать сайт. Проверьте ссылку и повторите попытку.");
  }
}
