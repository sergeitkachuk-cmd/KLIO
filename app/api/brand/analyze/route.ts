import { readWebsiteContext, websiteSourceLabel } from "../../_lib/website-context";
import { extractTavilyWebsite } from "../../_lib/tavily";
import { AiNotConfiguredError, AiResponseError, openAiErrorResponse } from "../../_lib/openai-response";
import { callAiModel } from "../../_lib/ai-router";
import { aiConfigured } from "../../_lib/ai-config";
import { assertSecondaryQuotaAvailable, recordResearch, workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../../_lib/workspace-account";
import { isAiRateLimited } from "../../_lib/rate-limit";
import { brandAnalysisInstructions, brandAnalysisSchema, normalizeBrandAnalysisResult, type BrandAnalysisResult } from "../../_lib/brand-analysis";

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

    const instructions = brandAnalysisInstructions(
      "Ты — бренд-стратег платформы КЛИО. По открытой странице сайта (и, если она недоступна или скудная, по данным из веб‑поиска) собери основу профиля бренда для редакционной команды.",
    );

    const { result, model } = await callAiModel<BrandAnalysisResult>({
      operation: "analyze_brand_website",
      ownerEmail: identity.email,
      schemaName: "klio_brand_analysis",
      schema: brandAnalysisSchema(),
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

    const normalized = normalizeBrandAnalysisResult(result, input.name);
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
