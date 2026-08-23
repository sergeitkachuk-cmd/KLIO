import { workspaceIdentity, WorkspaceAccessError } from "../_lib/workspace-account";

type DaDataSuggestion = {
  value?: unknown;
  data?: {
    inn?: unknown;
    type?: unknown;
    name?: { full_with_opf?: unknown; short_with_opf?: unknown };
    fio?: { surname?: unknown; name?: unknown; patronymic?: unknown };
    kpp?: unknown;
    ogrn?: unknown;
    address?: { value?: unknown };
    state?: { status?: unknown };
  };
};

function stringValue(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSuggestion(item: DaDataSuggestion) {
  const data = item.data ?? {};
  const inn = stringValue(data.inn, 20);
  if (!inn) return null;
  const type = data.type === "INDIVIDUAL" ? "sole_proprietor" : "legal_entity";
  const fio = data.fio ?? {};
  const displayName = stringValue(item.value) || stringValue(data.name?.short_with_opf) || [fio.surname, fio.name, fio.patronymic].map((part) => stringValue(part, 80)).filter(Boolean).join(" ");
  return {
    inn,
    type,
    display_name: displayName,
    full_name: stringValue(data.name?.full_with_opf) || displayName,
    kpp: stringValue(data.kpp, 20) || null,
    ogrn: stringValue(data.ogrn, 20) || null,
    address: stringValue(data.address?.value) || null,
    status: stringValue(data.state?.status, 40) || null,
  };
}

export async function POST(request: Request) {
  try {
    await workspaceIdentity();
    const token = process.env.DADATA_API_KEY?.trim();
    if (!token) return Response.json({ error: "Поиск реквизитов пока не настроен." }, { status: 503 });

    const input = await request.json().catch(() => ({}));
    const query = typeof input?.query === "string" ? input.query.trim().slice(0, 200) : "";
    if (query.length < 3) return Response.json({ companies: [] });

    const digits = query.replace(/\D/g, "");
    const exactInn = /^\d{10}(\d{2})?$/.test(digits) && digits === query;
    const endpoint = exactInn
      ? "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party"
      : "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party";
    const body = exactInn ? { query } : { query, count: 6 };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: "Сервис проверки реквизитов временно недоступен." }, { status: 502 });
    const payload = await response.json() as { suggestions?: DaDataSuggestion[] };
    const companies = (Array.isArray(payload.suggestions) ? payload.suggestions : [])
      .map(normalizeSuggestion)
      .filter((item): item is NonNullable<ReturnType<typeof normalizeSuggestion>> => Boolean(item));
    return Response.json({ companies });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Company lookup failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Не удалось выполнить поиск реквизитов." }, { status: 502 });
  }
}
