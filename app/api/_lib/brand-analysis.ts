import { CORE_SYSTEM_RULES } from "../../content-plans";

// Shared by api/brand/analyze/route.ts (reads a website) and
// api/brand/analyze-pdf/route.ts (reads an uploaded brand-book PDF) — both
// distill the same nine foundation fields from a text snapshot of an
// external source, differing only in what that source is and how it was
// obtained, so the schema/instructions/normalization live in one place
// rather than being kept in sync by hand in two route files.

export type BrandAnalysisResult = {
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

export function brandAnalysisSchema() {
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

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeBrandAnalysisResult(result: BrandAnalysisResult, fallbackName: string) {
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

// `opening` names the source in the very first line ("По открытой странице
// сайта..." vs "По содержимому PDF-файла с брендбуком..."); every fact-
// checking/anti-hallucination rule after it applies identically regardless
// of source.
export function brandAnalysisInstructions(opening: string) {
  return [
    opening,
    ...CORE_SYSTEM_RULES,
    "Работай как фактчекинговый редактор: внутренне различай прямые подтверждённые факты, осторожные редакционные гипотезы и отсутствующие сведения. Во внешний ответ текущей схемы включай только подтверждённое; интерпретацию формулируй осторожно и никогда не выдавай её за факт.",
    "Читай только то, что реально есть в источнике. Не открывай несуществующие разделы, не додумывай функциональность, услуги, цены, даты основания, размер команды, награды, клиентов или показатели.",
    "Не выдумывай продукты, услуги, доказательства, географию, голос, словарь, CTA, подпись, юридический статус или целевую аудиторию. Если данные скудны, используй только подтверждённую нейтральную формулировку, а не маркетинговый шаблон.",
    "name — официальное название компании/продукта. Если переданное название уже верное, верни его как есть; уточни только если в источнике оно явно другое.",
    "description — короткая фактическая справка: сфера, география, услуги и масштаб компании. 2–4 предложения, без рекламных эпитетов и превосходных степеней.",
    "positioning — редакционный ориентир: какое место бренд занимает в сознании аудитории. Не рекламный слоган и не список фич, а сжатая формулировка позиционирования в 1–2 предложениях. Если это лишь вывод из материалов, обозначай его осторожно без превосходства.",
    "audience — кто читатель: с какой задачей и на каком уровне понимания темы приходит к этому бренду. 1–3 предложения, без демографических догадок, которых нет в источнике.",
    "advantages — только подтверждённые особенности и факты из источника, на которые можно опираться в тексте; каждый факт с новой строки, без нумерации и без слов вроде «лучший» или «номер один», если это не прямая цитата.",
    "products — конкретные продукты, тарифы или программы бренда по факту источника; без общих слов вроде «широкий ассортимент», если нет конкретики.",
    "services — что компания реально делает для аудитории: перечень услуг по факту источника, без домыслов о том, чего там нет.",
    "proof — только реально подтверждённые основания доверия: документы, лицензии, сертификаты, конкретные условия программ, исследования, цифры из самого источника. Если ничего подобного нет — верни пустую строку, не придумывай и не обобщай в духе «команда профессионалов».",
    "geography — рынок и территория работы бренда (не путать с географией поискового спроса): город, регион, страна или формат (полностью онлайн). Если не указано — верни пустую строку.",
    "Уже заполненные поля профиля — это черновик пользователя, а не факт: используй их как подсказку о фокусе, но приоритет всегда у того, что подтверждено источником; явно устаревшее или неточное — исправляй.",
    "Если по теме почти ничего не удалось найти, честно пиши только то немногое, что подтверждено, короче — не заполняй пробелы предположениями.",
    "Пиши по-русски, нейтральным деловым тоном, без маркетинговых клише.",
    "Верни только структурированный результат по JSON‑схеме.",
  ].join("\n");
}
