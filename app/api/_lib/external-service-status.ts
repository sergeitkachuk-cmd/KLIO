import { request as httpsRequest } from "node:https";
import { tochkaRequest } from "./tochka";

type ServiceState = "connected" | "needs_setup" | "unavailable";

export type ExternalServiceStatus = {
  id: "deepseek" | "openai" | "tavily" | "yandex" | "dataforseo" | "tochka" | "unisender" | "dadata" | "render" | "github" | "timeweb";
  name: string;
  state: ServiceState;
  primary: string;
  detail: string;
  href: string;
};

const REQUEST_TIMEOUT_MS = 8_000;

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function money(value: number, currency = "USD"): string {
  const symbol = currency.toUpperCase() === "CNY" ? "¥" : "$";
  return `${symbol}${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Timeweb can prefer an unusable IPv6 route to a specific external host
// while its IPv4 endpoint works fine — confirmed for api.telegram.org
// (postToTelegramApi in social-publish.ts) and again for api.deepseek.com/
// api.openai.com (postJsonPinnedIPv4 in ai-router.ts), both the same
// connect-timeout signature, and evidently a Timeweb-wide network
// condition rather than one bad container (site owner: a brand-new
// Timeweb server showed the same symptom). Every check below shares that
// exact risk with whatever host it happens to be pointed at — pin all of
// them here once instead of waiting to rediscover this per service.
// Doubles as the fix for the actual monitoring gap this incident exposed:
// unpinned, this check could time out (or hang past its own deadline)
// through the same broken route real traffic did, but a plain page render
// has nobody around to notice it silently went red - the point of a
// health check is to catch exactly this class of failure, not share it.
function requestPinnedIPv4(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> {
  const endpoint = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: "GET",
      family: 4,
      signal,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) { response.destroy(new Error("Response is too large.")); return; }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(text) });
      });
      response.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function request(url: string, headers: Record<string, string>): Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> {
  return requestPinnedIPv4(url, headers, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
}

async function deepseekStatus(): Promise<ExternalServiceStatus> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return {
    id: "deepseek", name: "DeepSeek", state: "needs_setup", primary: "Ключ не задан",
    detail: "Добавьте DEEPSEEK_API_KEY в переменные окружения.", href: "https://platform.deepseek.com/usage",
  };

  try {
    const response = await request("https://api.deepseek.com/user/balance", { Authorization: `Bearer ${apiKey}` });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { is_available?: boolean; balance_infos?: Array<{ total_balance?: string | number; currency?: string }> };
    const balance = body.balance_infos?.[0];
    const value = numeric(balance?.total_balance);
    if (!body.is_available || value === null) throw new Error("Balance unavailable");
    return {
      id: "deepseek", name: "DeepSeek", state: "connected", primary: money(value, balance?.currency),
      detail: "Доступный остаток по данным DeepSeek.", href: "https://platform.deepseek.com/usage",
    };
  } catch {
    return {
      id: "deepseek", name: "DeepSeek", state: "unavailable", primary: "Не удалось проверить",
      detail: "Сервис не ответил в течение 8 секунд. Повторите обновление позже.", href: "https://platform.deepseek.com/usage",
    };
  }
}

// OpenAI is the default AI provider (AI_PROVIDER unset or anything other
// than "deepseek" — see ai-config.ts) yet had no status card at all. Its
// billing/usage endpoints are undocumented and increasingly unreliable for
// newer key types, so this checks connectivity the same honest way as
// Yandex Search below (key present + a real API call succeeds) rather than
// guessing at a balance shape that could silently break. /v1/models is a
// stable, documented, cheap call that fails clearly on a bad key.
async function openaiStatus(): Promise<ExternalServiceStatus> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return {
    id: "openai", name: "OpenAI", state: "needs_setup", primary: "Ключ не задан",
    detail: "Добавьте OPENAI_API_KEY в переменные окружения.", href: "https://platform.openai.com/usage",
  };
  try {
    const response = await request("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      id: "openai", name: "OpenAI", state: "connected", primary: "Подключён",
      detail: "OpenAI не отдаёт остаток средств через API ключа — проверяйте баланс в личном кабинете.", href: "https://platform.openai.com/usage",
    };
  } catch {
    return {
      id: "openai", name: "OpenAI", state: "unavailable", primary: "Не удалось проверить",
      detail: "Сервис не ответил в течение 8 секунд, либо ключ недействителен.", href: "https://platform.openai.com/usage",
    };
  }
}

async function tavilyStatus(): Promise<ExternalServiceStatus> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return {
    id: "tavily", name: "Tavily", state: "needs_setup", primary: "Ключ не задан",
    detail: "Добавьте TAVILY_API_KEY в переменные окружения.", href: "https://app.tavily.com/home",
  };

  try {
    const response = await request("https://api.tavily.com/usage", { Authorization: `Bearer ${apiKey}` });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const used = Object.entries(body)
      .filter(([key]) => key.endsWith("_usage") || key === "usage")
      .reduce((sum, [, value]) => sum + (numeric(value) ?? 0), 0);
    const limit = numeric(process.env.TAVILY_MONTHLY_CREDIT_LIMIT);
    const primary = limit !== null
      ? `${Math.max(0, limit - used).toLocaleString("ru-RU")} из ${limit.toLocaleString("ru-RU")} кредитов`
      : `${used.toLocaleString("ru-RU")} кредитов израсходовано`;
    return {
      id: "tavily", name: "Tavily", state: "connected", primary,
      detail: limit !== null ? "Остаток рассчитан для лимита, указанного в настройках." : "Укажите TAVILY_MONTHLY_CREDIT_LIMIT, чтобы видеть остаток.",
      href: "https://app.tavily.com/home",
    };
  } catch {
    return {
      id: "tavily", name: "Tavily", state: "unavailable", primary: "Не удалось проверить",
      detail: "Сервис не ответил в течение 8 секунд. Повторите обновление позже.", href: "https://app.tavily.com/home",
    };
  }
}

function yandexStatus(): ExternalServiceStatus {
  const ready = configured(process.env.YANDEX_SEARCH_API_KEY) && configured(process.env.YANDEX_FOLDER_ID);
  return ready
    ? {
      id: "yandex", name: "Yandex Search", state: "connected", primary: "Поиск подключён",
      detail: "Остаток средств не передаётся через ключ поиска: для него нужен отдельный доступ к биллингу Yandex Cloud.", href: "https://console.yandex.cloud/",
    }
    : {
      id: "yandex", name: "Yandex Search", state: "needs_setup", primary: "Не подключён",
      detail: "Добавьте ключ поиска и ID каталога Yandex Cloud.", href: "https://console.yandex.cloud/",
    };
}

// Prepaid-credit account, same shape as Tavily/DeepSeek above — see the
// "SEO-аудит" module's own comment on seoAuditLimit in plans.ts. Confirmed
// live 2026-09-15 that api.dataforseo.com is not affected by the Timeweb
// IPv6-routing issue the pinned request() helper above works around (see
// the comment on that function), so a plain fetch is fine here, matching
// how api/_lib/dataforseo.ts itself already talks to this host.
async function dataforseoStatus(): Promise<ExternalServiceStatus> {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) return {
    id: "dataforseo", name: "DataForSEO", state: "needs_setup", primary: "Ключи не заданы",
    detail: "Добавьте DATAFORSEO_LOGIN и DATAFORSEO_PASSWORD в переменные окружения.", href: "https://app.dataforseo.com/api-dashboard",
  };
  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const response = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { tasks?: Array<{ result?: Array<{ money?: { balance?: unknown } }> }> };
    const balance = numeric(body.tasks?.[0]?.result?.[0]?.money?.balance);
    if (balance === null) throw new Error("Balance unavailable");
    return {
      id: "dataforseo", name: "DataForSEO", state: "connected", primary: money(balance),
      detail: "Остаток препейд-баланса по данным DataForSEO.", href: "https://app.dataforseo.com/api-dashboard",
    };
  } catch {
    return {
      id: "dataforseo", name: "DataForSEO", state: "unavailable", primary: "Не удалось проверить",
      detail: "Сервис не ответил в течение 8 секунд. Повторите обновление позже.", href: "https://app.dataforseo.com/api-dashboard",
    };
  }
}

// Payment acquiring (see api/_lib/tochka.ts) — no balance concept here
// (money moves straight to the connected settlement account, not a prepaid
// credit the way an AI/data provider works), so this checks the same way
// Yandex Search does: key present + the customers endpoint actually
// accepts it. Reuses tochkaRequest() itself rather than the pinned-IPv4
// request() helper above — enter.tochka.com isn't among the hosts that
// helper exists for, and the rest of the payment code already talks to it
// this same way without issue.
async function tochkaStatus(): Promise<ExternalServiceStatus> {
  const token = process.env.TOCHKA_JWT_TOKEN?.trim();
  const clientId = process.env.TOCHKA_CLIENT_ID?.trim();
  if (!token || !clientId) return {
    id: "tochka", name: "Точка", state: "needs_setup", primary: "Не настроено",
    detail: "Добавьте TOCHKA_JWT_TOKEN и TOCHKA_CLIENT_ID для приёма платежей.", href: "https://enter.tochka.com/",
  };
  try {
    await tochkaRequest("/open-banking/v1.0/customers");
    return {
      id: "tochka", name: "Точка", state: "connected", primary: "Подключено",
      detail: "Приём платежей активен. Точный баланс расчётного счёта смотрите в интернет-банке.", href: "https://enter.tochka.com/",
    };
  } catch {
    return {
      id: "tochka", name: "Точка", state: "unavailable", primary: "Не удалось проверить",
      detail: "Сервис не ответил, либо ключ/Client_ID недействительны.", href: "https://enter.tochka.com/",
    };
  }
}

// Transactional email (verification, password reset, "Задать вопрос"
// notifications — see api/_lib/email.ts). Unisender Go has no simple
// balance-only endpoint to check safely here, so this stays a presence
// check like Yandex Search rather than guessing at a response shape.
function unisenderStatus(): ExternalServiceStatus {
  const ready = configured(process.env.UNISENDER_GO_API_KEY) && configured(process.env.UNISENDER_FROM_EMAIL);
  return ready
    ? {
      id: "unisender", name: "Unisender Go", state: "connected", primary: "Подключён",
      detail: "Остаток писем/лимиты смотрите в личном кабинете Unisender Go.", href: "https://go.unisender.ru/",
    }
    : {
      id: "unisender", name: "Unisender Go", state: "needs_setup", primary: "Не подключён",
      detail: "Добавьте UNISENDER_GO_API_KEY и UNISENDER_FROM_EMAIL — без них письма (подтверждение почты, сброс пароля) не отправляются.", href: "https://go.unisender.ru/",
    };
}

// Company/IP requisite autofill on invoices (see api/company-lookup). Same
// reasoning as Unisender Go above — presence check, not a guessed balance
// endpoint.
function dadataStatus(): ExternalServiceStatus {
  const ready = configured(process.env.DADATA_API_KEY);
  return ready
    ? {
      id: "dadata", name: "DaData", state: "connected", primary: "Подключён",
      detail: "Остаток запросов смотрите в личном кабинете DaData.", href: "https://dadata.ru/profile/",
    }
    : {
      id: "dadata", name: "DaData", state: "needs_setup", primary: "Не подключён",
      detail: "Добавьте DADATA_API_KEY — без него автозаполнение реквизитов на счетах недоступно.", href: "https://dadata.ru/profile/",
    };
}

async function renderStatus(): Promise<ExternalServiceStatus> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) return {
    id: "render", name: "Render", state: "needs_setup", primary: "Токен не задан",
    detail: "Добавьте RENDER_API_KEY, чтобы видеть состояние сервисов. Точный текущий счёт Render API не отдаёт.", href: "https://dashboard.render.com/",
  };
  try {
    const response = await request("https://api.render.com/v1/services?limit=100", { Authorization: `Bearer ${apiKey}`, Accept: "application/json" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as unknown;
    const services = Array.isArray(body) ? body : [];
    return {
      id: "render", name: "Render", state: "connected", primary: `${services.length} сервисов`,
      detail: "Подключение активно. Точный текущий счёт смотрите в Billing Dashboard Render.", href: "https://dashboard.render.com/",
    };
  } catch {
    return {
      id: "render", name: "Render", state: "unavailable", primary: "Не удалось проверить",
      detail: "Сервис не ответил в течение 8 секунд. Повторите обновление позже.", href: "https://dashboard.render.com/",
    };
  }
}

async function githubStatus(): Promise<ExternalServiceStatus> {
  const token = process.env.GITHUB_BILLING_TOKEN?.trim();
  const account = process.env.GITHUB_BILLING_ACCOUNT?.trim();
  const scope = process.env.GITHUB_BILLING_SCOPE === "org" ? "org" : "user";
  if (!token || !account) return {
    id: "github", name: "GitHub", state: "needs_setup", primary: "Токен не задан",
    detail: "Добавьте токен с правом Plan: read и имя личного аккаунта или организации.", href: "https://github.com/settings/billing",
  };
  try {
    const now = new Date();
    const path = scope === "org" ? `organizations/${encodeURIComponent(account)}` : `users/${encodeURIComponent(account)}`;
    const response = await request(`https://api.github.com/${path}/settings/billing/usage/summary?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { usageItems?: Array<{ netAmount?: number | string }> };
    const total = (body.usageItems ?? []).reduce((sum, item) => sum + (numeric(item.netAmount) ?? 0), 0);
    return {
      id: "github", name: "GitHub", state: "connected", primary: `${money(total)} за месяц`,
      detail: "Расходы за текущий календарный месяц по данным GitHub.", href: "https://github.com/settings/billing",
    };
  } catch {
    return {
      id: "github", name: "GitHub", state: "unavailable", primary: "Не удалось проверить",
      detail: "Проверьте токен, права Plan: read и тип аккаунта (user или org).", href: "https://github.com/settings/billing",
    };
  }
}

async function timewebStatus(): Promise<ExternalServiceStatus> {
  const token = process.env.TIMEWEB_CLOUD_TOKEN?.trim();
  if (!token) return {
    id: "timeweb", name: "Timeweb Cloud", state: "needs_setup", primary: "Токен не задан",
    detail: "Добавьте TIMEWEB_CLOUD_TOKEN в переменные окружения админки.", href: "https://timeweb.cloud/my/balance",
  };
  try {
    const response = await request("https://api.timeweb.cloud/api/v1/account/finances", {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { finances?: { balance?: unknown; currency?: unknown } };
    const balance = numeric(body.finances?.balance);
    if (balance === null) throw new Error("Balance unavailable");
    const currency = typeof body.finances?.currency === "string" ? body.finances.currency : "RUB";
    return {
      id: "timeweb", name: "Timeweb Cloud", state: "connected",
      primary: `${balance.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency === "RUB" ? "₽" : currency}`,
      detail: "Текущий баланс аккаунта Timeweb Cloud по API.", href: "https://timeweb.cloud/my/balance",
    };
  } catch {
    return {
      id: "timeweb", name: "Timeweb Cloud", state: "unavailable", primary: "Не удалось проверить",
      detail: "API Timeweb Cloud не ответил или токен не имеет доступа к финансам.", href: "https://timeweb.cloud/my/balance",
    };
  }
}

export async function getExternalServiceStatuses(): Promise<ExternalServiceStatus[]> {
  const [deepseek, openai, tavily, dataforseo, tochka, render, github, timeweb] = await Promise.all([
    deepseekStatus(), openaiStatus(), tavilyStatus(), dataforseoStatus(), tochkaStatus(), renderStatus(), githubStatus(), timewebStatus(),
  ]);
  return [deepseek, openai, tavily, yandexStatus(), dataforseo, tochka, unisenderStatus(), dadataStatus(), render, github, timeweb];
}
