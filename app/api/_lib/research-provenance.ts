import type { TavilyResearch } from "./tavily";

export function researchProvenance(research: TavilyResearch | null) {
  const sources = (research?.results || []).slice(0, 5).flatMap(item => {
    try {
      const url = new URL(item.url);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.toString().length > 1200) return [];
      return [{ title: item.title.replace(/\s+/g, " ").slice(0, 160), url: url.toString() }];
    } catch { return []; }
  });
  return { status: sources.length ? "available" as const : "unavailable" as const, provider: research?.provider || null, sources };
}

export function researchEditorialNote(research: TavilyResearch | null) {
  const provenance = researchProvenance(research);
  if (!provenance.sources.length) return "Внешний поиск не предоставил источников. Перед публикацией проверьте фактические утверждения; материал не считается проверенным по внешним источникам.";
  return `Источники, переданные ИИ при подготовке (перечень не означает независимой проверки фактов):\n${provenance.sources.map(source => `• ${source.title}: ${source.url}`).join("\n")}`;
}
