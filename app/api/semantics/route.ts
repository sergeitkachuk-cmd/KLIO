import { AiNotConfiguredError, AiResponseError, openAiErrorResponse } from "../_lib/openai-response";
import { callAiModel } from "../_lib/ai-router";
import { aiConfigured } from "../_lib/ai-config";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";
import { isAiRateLimited } from "../_lib/rate-limit";

type Intent = "Информационный" | "Коммерческий" | "Транзакционный" | "Смешанный" | "Навигационный";
type Role = "Основной" | "Поддерживающий" | "Вопрос" | "Гео";
type Relation = "Ядро" | "Синоним" | "Проблема" | "Решение" | "Смежный" | "Вопрос" | "Бренд" | "Гео";
type Breadth = "Широкий" | "Средний" | "Узкий";

type SemanticKeyword = { id: string; phrase: string; cluster: string; intent: Intent; role: Role; relation: Relation; breadth: Breadth; recommended: boolean; note: string; frequency: number };
type SemanticResult = { primaryQuery: string; intent: { label: string; stage: string; summary: string }; suggestedTopic: string; recommendedLength: number; keywords: SemanticKeyword[]; dataNote: string };
type SemanticPayload = { query?: unknown; geography?: unknown; region?: unknown; brand?: unknown };
type WordstatItem = { phrase?: unknown; count?: unknown };
type GeographyTarget = { label: string };
type RegionNode = { id?: unknown; label?: unknown; children?: unknown };

let regionIndexPromise: Promise<Map<string, string>> | null = null;

const clean = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();

function schema() {
  const keyword = {
    type: "object", properties: {
      phrase: { type: "string" }, cluster: { type: "string" }, intent: { type: "string", enum: ["Информационный", "Коммерческий", "Транзакционный", "Смешанный", "Навигационный"] },
      role: { type: "string", enum: ["Основной", "Поддерживающий", "Вопрос", "Гео"] }, relation: { type: "string", enum: ["Ядро", "Синоним", "Проблема", "Решение", "Смежный", "Вопрос", "Бренд", "Гео"] },
      breadth: { type: "string", enum: ["Широкий", "Средний", "Узкий"] }, recommended: { type: "boolean" }, note: { type: "string" },
    }, required: ["phrase", "cluster", "intent", "role", "relation", "breadth", "recommended", "note"], additionalProperties: false,
  };
  return { type: "object", properties: {
    intent: { type: "object", properties: { label: { type: "string" }, stage: { type: "string" }, summary: { type: "string" } }, required: ["label", "stage", "summary"], additionalProperties: false },
    suggestedTopic: { type: "string" }, recommendedLength: { type: "integer" }, keywords: { type: "array", minItems: 8, maxItems: 30, items: keyword },
  }, required: ["intent", "suggestedTopic", "recommendedLength", "keywords"], additionalProperties: false };
}

function seedSchema() {
  return { type: "object", properties: {
    market: { type: "string" },
    seeds: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
  }, required: ["market", "seeds"], additionalProperties: false };
}

function cleanBrand(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { name: clean(source.name, 160), description: clean(source.description, 1200), positioning: clean(source.positioning, 900), services: clean(source.services, 1600), audience: clean(source.audience, 900) };
}

function cleanGeography(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 24).map((item) => ({ label: clean(item && typeof item === "object" ? (item as Record<string, unknown>).label : "", 140) })).filter((item): item is GeographyTarget => Boolean(item.label)) : [];
}

async function regionIndex() {
  if (regionIndexPromise) return regionIndexPromise;
  regionIndexPromise = (async () => {
    const apiKey = process.env.YANDEX_SEARCH_API_KEY?.trim();
    const folderId = process.env.YANDEX_FOLDER_ID?.trim();
    if (!apiKey || !folderId) throw new AiResponseError("Частотность не подключена: добавьте YANDEX_SEARCH_API_KEY и YANDEX_FOLDER_ID на сервере.", 503);
    const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/wordstat/regionsTree", { method: "POST", headers: { Authorization: `Api-key ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ folderId }) });
    if (!response.ok) throw new AiResponseError("Не удалось получить справочник регионов для выбранной географии.", 502);
    const body = await response.json() as { regions?: unknown };
    const index = new Map<string, string>();
    const visit = (node: RegionNode) => {
      const label = clean(node.label, 180); const id = clean(node.id, 40);
      if (label && id) index.set(normalize(label), id);
      if (Array.isArray(node.children)) node.children.forEach((child) => { if (child && typeof child === "object") visit(child as RegionNode); });
    };
    if (Array.isArray(body.regions)) body.regions.forEach((item) => { if (item && typeof item === "object") visit(item as RegionNode); });
    return index;
  })();
  try { return await regionIndexPromise; } catch (error) { regionIndexPromise = null; throw error; }
}

async function resolveRegions(geography: GeographyTarget[]) {
  if (!geography.length) return { ids: ["225"], label: "Россия" };
  const index = await regionIndex();
  const ids = geography.map((item) => index.get(normalize(item.label))).filter((item): item is string => Boolean(item));
  if (!ids.length) throw new AiResponseError("Не удалось сопоставить выбранную географию с поисковым регионом. Измените географию и повторите анализ.", 422);
  return { ids: [...new Set(ids)], label: geography.map((item) => item.label).join(", ") };
}

async function wordstat(query: string, regions: string[]) {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY?.trim();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  if (!apiKey || !folderId) throw new AiResponseError("Частотность не подключена: добавьте YANDEX_SEARCH_API_KEY и YANDEX_FOLDER_ID на сервере.", 503);
  const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests", {
    method: "POST", headers: { Authorization: `Api-key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phrase: query, numPhrases: 100, regions, devices: ["DEVICE_ALL"], folderId }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Yandex Wordstat request failed", response.status, detail.slice(0, 800));
    let providerMessage = "";
    try {
      const parsed = JSON.parse(detail) as { message?: unknown; error?: { message?: unknown } };
      providerMessage = clean(parsed.message ?? parsed.error?.message, 360);
    } catch { /* A non-JSON error is still useful in the server log only. */ }
    const explanation = providerMessage ? ` Ответ Yandex: ${providerMessage}` : "";
    if (response.status === 401 || response.status === 403) {
      throw new AiResponseError(`Источник поисковых данных временно недоступен.${explanation} Повторите попытку позже.`, 502);
    }
    throw new AiResponseError(`Источник поисковых данных временно не ответил.${explanation} Повторите попытку позже.`, 502);
  }
  const body = await response.json() as { results?: WordstatItem[]; associations?: WordstatItem[] };
  const source = [...(body.results ?? []), ...(body.associations ?? [])];
  const seen = new Set<string>();
  const items = source.map((item) => ({ phrase: clean(item.phrase, 180), frequency: typeof item.count === "string" || typeof item.count === "number" ? Number(item.count) : 0 }))
    .filter((item) => item.phrase && Number.isFinite(item.frequency) && item.frequency > 0)
    .filter((item) => { const key = normalize(item.phrase); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.frequency - a.frequency).slice(0, 80);
  return items;
}

export async function POST(request: Request) {
  try {
    if (isAiRateLimited(request, "research", 2)) return Response.json({ error: "Слишком много исследований подряд. Подождите минуту и повторите." }, { status: 429 });
    const payload = await request.json() as SemanticPayload;
    const query = clean(payload.query, 240);
    if (!query) return Response.json({ error: "Введите основной запрос или тему." }, { status: 400 });
    await assertSecondaryQuotaAvailable("research");
    if (!aiConfigured()) throw new AiNotConfiguredError();
    const identity = await workspaceIdentity();
    const brand = cleanBrand(payload.brand);
    const geography = cleanGeography(payload.geography);
    const searchRegion = await resolveRegions(geography);
    const seedPlan = await callAiModel<{ market: string; seeds: string[] }>({
      operation: "research_semantics", ownerEmail: identity.email, schemaName: "klio_semantic_growth_seeds", schema: seedSchema(),
      instructions: [
        "Ты SEO-стратег. Определи рынок и сформируй 3–5 коротких русскоязычных исходных фраз для поиска НОВОЙ аудитории.",
        "Если исходная тема — бренд, его название нельзя использовать в seeds. Отталкивайся от категории, услуг, географии и задач потенциального клиента.",
        "Используй только переданную географию спроса. География присутствия бренда не имеет права сужать охват, выбранный пользователем.",
        "Не давай сверхширокие одиночные слова. Каждая seed-фраза должна выражать самостоятельный реальный спрос будущего клиента.",
        "Не называй частотность и не возвращай пояснения вне JSON.",
      ].join("\n"), input: JSON.stringify({ query, search_demand_geography: searchRegion.label, brand: brand.name ? brand : null }, null, 2),
    });
    const seeds = [query, ...seedPlan.result.seeds.map((item) => clean(item, 180))].filter(Boolean)
      .filter((item, index, all) => all.findIndex((candidate) => normalize(candidate) === normalize(item)) === index).slice(0, 6);
    const collected = (await Promise.all(seeds.map((seed) => wordstat(seed, searchRegion.ids)))).flat();
    const counts = new Map<string, number>();
    for (const candidate of collected) {
      const key = normalize(candidate.phrase);
      counts.set(key, Math.max(counts.get(key) ?? 0, candidate.frequency));
    }
    const candidates = [...counts.entries()].map(([key, frequency]) => ({ phrase: collected.find((item) => normalize(item.phrase) === key)?.phrase || key, frequency }))
      .sort((a, b) => b.frequency - a.frequency).slice(0, 140);
    if (candidates.length < 8) throw new AiResponseError("Источник поисковых данных вернул слишком мало реальных запросов по этой теме. Уточните формулировку или профиль бренда.", 422);
    const ai = await callAiModel<Omit<SemanticResult, "primaryQuery" | "dataNote">>({
      operation: "research_semantics", ownerEmail: identity.email, schemaName: "klio_wordstat_semantic_map", schema: schema(),
      instructions: [
        "Ты SEO-стратег. Классифицируй только фразы, переданные из проверенных поисковых данных.",
        "Нельзя придумывать, заменять или перефразировать фразы; частотность не оценивай и не называй.",
        "Работай только с переданной географией спроса: не подменяй её регионом присутствия бренда.",
        "Раздели фразы на кластеры по одному поисковому намерению. По умолчанию выбери для recommended ОДИН небрендовый кластер, который приводит новую аудиторию; брендовый кластер выбирай только если небрендовых фраз нет.",
        "Для одного будущего материала отметь recommended только 1 основной и 3–5 близких поддерживающих фраз из ОДНОГО кластера. Внутри кластера предпочитай более частотные и недублирующие фразы.",
        "Не смешивай в recommended коммерческие, информационные, навигационные и иные несовместимые намерения. Верни 8–30 фраз из списка.",
        "recommendedLength — разумный объём будущего материала в знаках с пробелами: для подробной SEO-статьи обычно 5 000–12 000, не в словах.",
      ].join("\n"), input: JSON.stringify({ original_query: query, search_demand_geography: searchRegion.label, market: clean(seedPlan.result.market, 180), brand_name: brand.name || null, growth_seeds: seeds.slice(1), verified_candidates_last_30_days: candidates }, null, 2),
    });
    const seen = new Set<string>();
    const keywords = ai.result.keywords.map((item, index) => {
      const phrase = clean(item.phrase, 180); const key = normalize(phrase); const frequency = counts.get(key);
      if (!frequency || seen.has(key)) return null; seen.add(key);
      return { ...item, id: `semantic-${index + 1}`, phrase, cluster: clean(item.cluster, 100) || "Основная тема", note: clean(item.note, 300), frequency };
    }).filter((item): item is SemanticKeyword => Boolean(item));
    if (keywords.length < 8) throw new AiResponseError("AI не смог корректно классифицировать поисковые данные. Повторите анализ.", 502);
    const preferredClusters = new Set(keywords.filter((item) => item.recommended).map((item) => item.cluster));
    const primaryCluster = [...preferredClusters].sort((a, b) => {
      const score = (cluster: string) => keywords.filter((item) => item.cluster === cluster && item.recommended).reduce((sum, item) => sum + item.frequency, 0);
      return score(b) - score(a);
    })[0] || keywords[0].cluster;
    const rankedCluster = keywords.filter((item) => item.cluster === primaryCluster).sort((a, b) => b.frequency - a.frequency).slice(0, 6);
    const selectedIds = new Set(rankedCluster.map((item) => item.id));
    const primaryId = rankedCluster[0]?.id;
    const finalKeywords = keywords.map((item) => ({
      ...item,
      role: item.id === primaryId ? "Основной" as Role : item.role === "Основной" ? "Поддерживающий" as Role : item.role,
      relation: item.id === primaryId ? "Ядро" as Relation : item.relation,
      recommended: selectedIds.has(item.id),
    })).sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.frequency - a.frequency);
    const usage = await recordResearch();
    return Response.json({ result: { primaryQuery: query, intent: ai.result.intent, suggestedTopic: clean(ai.result.suggestedTopic, 240) || query, recommendedLength: Math.min(21000, Math.max(5000, Number(ai.result.recommendedLength) || 8400)), keywords: finalKeywords, dataNote: `Фразы и частотность подтверждены актуальными поисковыми данными за последние 30 дней для географии: ${searchRegion.label}. В карте отдельно выделяются брендовый спрос и запросы новой аудитории; рекомендации собраны из одного наиболее сильного кластера.` }, mode: "ai", model: ai.model, sources: { searchDemand: "verified", geography: searchRegion.label, candidates: candidates.length, market: clean(seedPlan.result.market, 180) }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось получить поисковые данные для семантики.");
  }
}
