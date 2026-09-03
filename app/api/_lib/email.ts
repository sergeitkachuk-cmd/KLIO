// Minimal Unisender Go REST client — no SDK dependency, just fetch. See
// https://godocs.unisender.ru/web-api-ref#email-send
const UNISENDER_GO_API_URL = "https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json";
const FROM_NAME = "КЛИО";

export function emailDeliveryAvailable() {
  return Boolean(process.env.UNISENDER_GO_API_KEY?.trim());
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] as string));
}

function emailShell(title: string, bodyHtml: string) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="font-size: 20px;">${title}</h1>
      ${bodyHtml}
    </div>
  `;
}

async function sendTransactionalEmail(params: { to: string; subject: string; html: string; plaintext: string }) {
  const apiKey = process.env.UNISENDER_GO_API_KEY?.trim();
  if (!apiKey) throw new Error("UNISENDER_GO_API_KEY не настроен.");
  const fromEmail = process.env.UNISENDER_FROM_EMAIL?.trim();
  if (!fromEmail) throw new Error("UNISENDER_FROM_EMAIL не настроен.");

  // Set once noreply.<domain> shows "Настроен" with a real Backend ID under
  // Unisender Go's "Домены ссылок" — passing it explicitly avoids the
  // account falling back to whichever backend domain it picks by default
  // (the account also has an unrelated "unieml.ru" entry sitting in
  // "Запрещен" status, which we never want selected).
  const backendId = process.env.UNISENDER_BACKEND_ID?.trim();

  const response = await fetch(UNISENDER_GO_API_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        recipients: [{ email: params.to }],
        subject: params.subject,
        from_email: fromEmail,
        from_name: FROM_NAME,
        body: { html: params.html, plaintext: params.plaintext },
        // These are plain transactional emails (verification link, trial
        // notice) — no click/open analytics needed, and enabling tracking
        // requires a configured tracking/backend domain we don't want to
        // depend on (see "Custom backend domain or tracking domain
        // required for sending" — Unisender Go's error when track_links
        // defaults on with no tracking domain set up).
        track_links: 0,
        track_read: 0,
        ...(backendId ? { custom_backend_id: Number(backendId) } : {}),
      },
    }),
  });

  const payload = await response.json().catch(() => null) as
    | { status?: string; message?: string; failed_emails?: Record<string, unknown> }
    | null;

  // Unisender Go can return HTTP 200 with status: "error" (bad request) or
  // with a per-recipient failure in failed_emails even on an accepted job —
  // both need to surface as a real failure, not a silent success.
  const failed = payload?.failed_emails && Object.keys(payload.failed_emails).length > 0;
  if (!response.ok || payload?.status === "error" || failed) {
    const detail = payload?.message || (failed ? JSON.stringify(payload!.failed_emails) : `HTTP ${response.status}`);
    throw new Error(`Unisender Go вернул ошибку: ${detail}`);
  }
}

export async function sendVerificationEmail(email: string, verifyUrl: string) {
  const safeUrl = escapeHtml(verifyUrl);
  await sendTransactionalEmail({
    to: email,
    subject: "Подтвердите email в КЛИО",
    html: emailShell("Подтвердите email", `
      <p>Чтобы открыть личный кабинет КЛИО, подтвердите этот адрес — ссылка действует 24 часа.</p>
      <p><a href="${safeUrl}" style="display: inline-block; padding: 12px 22px; border-radius: 10px; background: #101015; color: #fff; text-decoration: none; font-weight: 650;">Подтвердить email</a></p>
      <p style="color: #686879; font-size: 13px;">Если вы не регистрировались в КЛИО — просто проигнорируйте это письмо.</p>
    `),
    plaintext: `Подтвердите email в КЛИО: ${verifyUrl} (ссылка действует 24 часа). Если вы не регистрировались — проигнорируйте это письмо.`,
  });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const safeUrl = escapeHtml(resetUrl);
  await sendTransactionalEmail({
    to: email,
    subject: "Смена пароля в КЛИО",
    html: emailShell("Смена пароля", `
      <p>Вы запросили смену пароля для личного кабинета КЛИО. Ссылка действует 1 час и только один раз.</p>
      <p><a href="${safeUrl}" style="display: inline-block; padding: 12px 22px; border-radius: 10px; background: #101015; color: #fff; text-decoration: none; font-weight: 650;">Задать новый пароль</a></p>
      <p style="color: #686879; font-size: 13px;">Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.</p>
    `),
    plaintext: `Смена пароля в КЛИО: ${resetUrl} (ссылка действует 1 час и только один раз). Если вы не запрашивали смену пароля, проигнорируйте это письмо.`,
  });
}

// Sent by the publish-due cron (api/cron/publish-due/route.ts) once a
// publication has exhausted MAX_PUBLISH_RETRIES and is marked "failed" for
// good — the calendar itself already flags this visually, but a person only
// checks the calendar if they remember to; a scheduled post silently not
// going out is the one failure mode worth interrupting them for.
export async function sendPublicationFailedEmail(email: string, params: { channelLabel: string; materialTitle: string; reason: string; workspaceUrl: string }) {
  const safeUrl = escapeHtml(params.workspaceUrl);
  const safeChannel = escapeHtml(params.channelLabel);
  const safeTitle = escapeHtml(params.materialTitle);
  const safeReason = escapeHtml(params.reason);
  await sendTransactionalEmail({
    to: email,
    subject: `Не удалось опубликовать «${params.materialTitle}»`,
    html: emailShell("Публикация не удалась", `
      <p>КЛИО не смог опубликовать материал «${safeTitle}» в канал «${safeChannel}» после нескольких попыток.</p>
      <p style="color: #686879; font-size: 13px;">Причина: ${safeReason}</p>
      <p><a href="${safeUrl}" style="display: inline-block; padding: 12px 22px; border-radius: 10px; background: #101015; color: #fff; text-decoration: none; font-weight: 650;">Открыть КЛИО</a></p>
    `),
    plaintext: `КЛИО не смог опубликовать материал «${params.materialTitle}» в канал «${params.channelLabel}». Причина: ${params.reason}. Открыть КЛИО: ${params.workspaceUrl}`,
  });
}

// Sent by the trial-reminder cron job (not yet wired up — see workspace-account.ts's
// TRIAL_DURATION_MS) once an account is approaching the end of its 48h trial window.
export async function sendTrialEndingEmail(email: string, workspaceUrl: string) {
  const safeUrl = escapeHtml(workspaceUrl);
  await sendTransactionalEmail({
    to: email,
    subject: "Пробный период в КЛИО скоро закончится",
    html: emailShell("Пробный период скоро закончится", `
      <p>Ваш пробный доступ к КЛИО заканчивается в течение ближайших часов. После этого генерация, семантика и другие ИИ-инструменты станут недоступны, пока вы не перейдёте на платный тариф.</p>
      <p><a href="${safeUrl}" style="display: inline-block; padding: 12px 22px; border-radius: 10px; background: #101015; color: #fff; text-decoration: none; font-weight: 650;">Открыть КЛИО</a></p>
    `),
    plaintext: `Ваш пробный доступ к КЛИО заканчивается в течение ближайших часов. Открыть КЛИО: ${workspaceUrl}`,
  });
}
