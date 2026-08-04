// Minimal Resend REST client — no SDK dependency, just fetch. See
// https://resend.com/docs/api-reference/emails/send-email
const RESEND_API_URL = "https://api.resend.com/emails";

export function emailDeliveryAvailable() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
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

export async function sendVerificationEmail(email: string, verifyUrl: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY не настроен.");
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "KLIO <onboarding@resend.dev>";
  const safeUrl = escapeHtml(verifyUrl);

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Подтвердите email в КЛИО",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h1 style="font-size: 20px;">Подтвердите email</h1>
          <p>Чтобы открыть личный кабинет КЛИО, подтвердите этот адрес — ссылка действует 24 часа.</p>
          <p><a href="${safeUrl}" style="display: inline-block; padding: 12px 22px; border-radius: 10px; background: #101015; color: #fff; text-decoration: none; font-weight: 650;">Подтвердить email</a></p>
          <p style="color: #686879; font-size: 13px;">Если вы не регистрировались в КЛИО — просто проигнорируйте это письмо.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend API вернул ошибку ${response.status}: ${detail.slice(0, 300)}`);
  }
}
