type ServiceState = "connected" | "needs_setup" | "unavailable";

export type ExternalServiceStatus = {
  id: "deepseek" | "tavily" | "yandex" | "render" | "github";
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

async function request(url: string, headers: HeadersInit): Promise<Response> {
  return fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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

export async function getExternalServiceStatuses(): Promise<ExternalServiceStatus[]> {
  const [deepseek, tavily, render, github] = await Promise.all([deepseekStatus(), tavilyStatus(), renderStatus(), githubStatus()]);
  return [deepseek, tavily, yandexStatus(), render, github];
}
