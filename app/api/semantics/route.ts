import { AiNotConfiguredError, AiResponseError, openAiErrorResponse } from "../_lib/openai-response";
import { callAiModel } from "../_lib/ai-router";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

type Intent = "Информационный" | "Коммерческий" | "Транзакционный" | "Смешанный" | "Навигационный";
type Role = "Основной" | "Поддерживающий" | "Вопрос" | "Гео";
type Relation = "Ядро" | "Синоним" | "Проблема" | "Решение" | "Смежный" | "Вопрос" | "Бренд" | "Гео";
type Breadth = "Широкий" | "Средний" | "Узкий";

type SemanticKeyword = { id: string; phrase: string; cluster: string; intent: Intent; role: Role; relation: Relation; breadth: Breadth; recommended: boolean; note: string; frequency: number; source: "Yandex Wordstat" };
type SemanticResult = { primaryQuery: string; intent: { label: string; stage: string; summary: string }; suggestedTopic: string; recommendedLength: number; keywords: SemanticKeyword[]; dataNote: string };
type SemanticPayload = { query?: unknown; geography?: unknown; region?: unknown };
type WordstatItem = { phrase?: unknown; count?: unknown };

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

async function wordstat(query: string) {
  const apiKey = process.env.YANDEX_SEARCH_API_KEY?.trim();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  if (!apiKey || !folderId) throw new AiResponseError("Частотность не подключена: добавьте YANDEX_SEARCH_API_KEY и YANDEX_FOLDER_ID на сервере.", 503);
  const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests", {
    method: "POST", headers: { Authorization: `Api-Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phrase: query, numPhrases: 100, devices: ["DEVICE_ALL"], folderId }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Yandex Wordstat request failed", response.status, detail.slice(0, 800));
    throw new AiResponseError(response.status === 401 || response.status === 403 ? "Yandex Wordstat не принял ключ или у сервисного аккаунта нет роли search-api.webSearch.user." : "Yandex Wordstat временно не ответил. Повторите попытку позже.", 502);
  }
  const body = await response.json() as { results?: WordstatItem[]; associations?: WordstatItem[] };
  const source = [...(body.results ?? []), ...(body.associations ?? [])];
  const seen = new Set<string>();
  const items = source.map((item) => ({ phrase: clean(item.phrase, 180), frequency: typeof item.count === "string" || typeof item.count === "number" ? Number(item.count) : 0 }))
    .filter((item) => item.phrase && Number.isFinite(item.frequency) && item.frequency > 0)
    .filter((item) => { const key = normalize(item.phrase); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.frequency - a.frequency).slice(0, 80);
  if (items.length < 8) throw new AiResponseError("Wordstat вернул слишком мало реальных запросов по этой формулировке. Уточните тему или измените основной запрос.", 422);
  return items;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as SemanticPayload;
    const query = clean(payload.query, 240);
    if (!query) return Response.json({ error: "Введите основной запрос или тему." }, { status: 400 });
    await assertSecondaryQuotaAvailable("research");
    if (!process.env.OPENAI_API_KEY?.trim()) throw new AiNotConfiguredError();
    const identity = await workspaceIdentity();
    const candidates = await wordstat(query);
    const counts = new Map(candidates.map((item) => [normalize(item.phrase), item.frequency]));
    const ai = await callAiModel<Omit<SemanticResult, "primaryQuery" | "dataNote">>({
      operation: "research_semantics", ownerEmail: identity.email, schemaName: "klio_wordstat_semantic_map", schema: schema(),
      instructions: [
        "Ты SEO-стратег. Классифицируй только фразы, переданные из Yandex Wordstat.",
        "Нельзя придумывать, заменять или перефразировать фразы; частотность не оценивай и не называй.",
        "Раздели фразы на кластеры по одному поисковому намерению. Для одного будущего материала отметь recommended только 1 основной и 3–5 близких поддерживающих фраз из ОДНОГО кластера.",
        "Не смешивай в recommended коммерческие, информационные, навигационные и иные несовместимые намерения. Верни 8–30 фраз из списка.",
      ].join("\n"), input: JSON.stringify({ original_query: query, wordstat_candidates_last_30_days: candidates }, null, 2),
    });
    const seen = new Set<string>();
    const keywords = ai.result.keywords.map((item, index) => {
      const phrase = clean(item.phrase, 180); const key = normalize(phrase); const frequency = counts.get(key);
      if (!frequency || seen.has(key)) return null; seen.add(key);
      return { ...item, id: `semantic-${index + 1}`, phrase, cluster: clean(item.cluster, 100) || "Основная тема", note: clean(item.note, 300), frequency, source: "Yandex Wordstat" as const };
    }).filter((item): item is SemanticKeyword => Boolean(item));
    if (keywords.length < 8) throw new AiResponseError("AI не смог корректно классифицировать данные Wordstat. Повторите анализ.", 502);
    const primaryIndex = keywords.findIndex((item) => item.role === "Основной");
    const primary = primaryIndex >= 0 ? primaryIndex : 0;
    const primaryCluster = keywords[primary].cluster;
    const selected = keywords.map((item, index) => ({ ...item, role: index === primary ? "Основной" as Role : item.role === "Основной" ? "Поддерживающий" as Role : item.role, relation: index === primary ? "Ядро" as Relation : item.relation }));
    let recommended = 0;
    const finalKeywords = selected.map((item, index) => {
      const shouldRecommend = item.cluster === primaryCluster && (index === primary || (item.recommended && recommended < 5));
      if (shouldRecommend) recommended += 1;
      return { ...item, recommended: shouldRecommend };
    });
    const usage = await recordResearch();
    return Response.json({ result: { primaryQuery: query, intent: ai.result.intent, suggestedTopic: clean(ai.result.suggestedTopic, 240) || query, recommendedLength: Math.min(3000, Math.max(700, Number(ai.result.recommendedLength) || 1200)), keywords: finalKeywords, dataNote: "Фразы и частотность получены из Yandex Wordstat: число запросов за последние 30 дней. AI только сгруппировал реальные фразы по интенту; частотность не сгенерирована." }, mode: "ai", model: ai.model, sources: { wordstat: "Yandex Search API", candidates: candidates.length }, usage });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return openAiErrorResponse(error, "Не удалось получить семантику из Yandex Wordstat.");
  }
}
