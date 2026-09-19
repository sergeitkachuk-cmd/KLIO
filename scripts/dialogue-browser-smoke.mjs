// Local-only browser integration test. Runs the real dialogue route against
// ephemeral PostgreSQL; AI, account identity and publication delivery are fixtures.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createDialogueHarness } from "../tests/helpers/dialogue-harness.mjs";

const base = process.argv[2] || "http://localhost:3027";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Only local fixture servers are allowed");
const output = resolve("outputs/dialogue-check");
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "klio-dialogue-browser-"));
const h = await createDialogueHarness();
const brandId = "dialogue-fixture-brand";
await h.db
  .insert(h.schema.brands)
  .values({
    id: brandId,
    ownerEmail: h.owner,
    name: "Кофейня Утро",
    profileJson: JSON.stringify({
      name: "Кофейня Утро",
      description: "Кофе и завтраки до 12:00",
      audience: "Жители района",
      voice: "Тёплый и простой",
    }),
  });
await h.db
  .update(h.schema.accounts)
  .set({ workspaceMode: "dialogue" })
  .where(eq(h.schema.accounts.email, h.owner));
const chrome = spawn(
  process.env.CHROME_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
const errors = [];
let publicationsWritten = 0;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Chrome startup timeout")),
      15000,
    );
    let stderr = "";
    chrome.stderr.on("data", (bytes) => {
      stderr += bytes;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.on("error", reject);
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  let serial = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error.message));
      else p.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(
        () => reject(new Error(`CDP timeout ${method}`)),
        20000,
      );
      pending.set(id, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const cmd = (method, params) => send(method, params, sessionId);
  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    let payload = {};
    let status = 200;
    try {
      if (url.pathname === "/api/dialogue") {
        const response =
          request.method === "POST"
            ? await h.route.POST(
                new Request(request.url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: request.postData,
                }),
              )
            : await h.route.GET(new Request(request.url));
        status = response.status;
        payload = await response.json();
      } else if (url.pathname === "/api/workspace") {
        const a = await h.account();
        const account = {
          planId: "start",
          planName: "Тестовый кабинет",
          generationsUsed: a.generationsUsed,
          generationLimit: 30,
          generationsRemaining: 30 - a.generationsUsed,
          researchUsed: 0,
          researchLimit: 10,
          researchRemaining: 10,
          editorActionsUsed: a.editorActionsUsed,
          editorActionLimit: 100,
          editorActionsRemaining: 100 - a.editorActionsUsed,
          lifetimeGenerationsUsed: 0,
          lifetimeResearchUsed: 0,
          lifetimeEditorActionsUsed: a.lifetimeEditorActionsUsed,
          daysWithKlio: 1,
          brandCount: 1,
          brandLimit: 5,
          seatLimit: 1,
          period: "2026-09",
        };
        if (request.method === "POST") {
          const p = JSON.parse(request.postData);
          if (p.action === "save_brand") {
            await h.db
              .update(h.schema.brands)
              .set({
                name: p.profile.name,
                profileJson: JSON.stringify(p.profile),
                workspaceJson: JSON.stringify(p.workspace),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(h.schema.brands.id, p.brandId));
          }
          if (p.action === "update_generation") {
            const { id, ...values } = p.generation;
            const [generation] = await h.db
              .update(h.schema.generations)
              .set(values)
              .where(eq(h.schema.generations.id, id))
              .returning();
            payload = { generation };
          }
          const [b] = await h.db
            .select()
            .from(h.schema.brands)
            .where(eq(h.schema.brands.id, brandId));
          payload = {
            ...payload,
            brand: {
              ...b,
              profile: JSON.parse(b.profileJson),
              workspace: JSON.parse(b.workspaceJson),
            },
            account,
          };
        } else {
          const brands = await h.db.select().from(h.schema.brands);
          payload = {
            user: { email: h.owner, displayName: "Анна" },
            account,
            workspaceMode: a.workspaceMode,
            brands: brands.map((b) => ({
              ...b,
              profile: JSON.parse(b.profileJson),
              workspace: JSON.parse(b.workspaceJson),
            })),
            history: await h.db.select().from(h.schema.generations),
            next: { history: null, materials: null },
            materials: [],
          };
        }
      } else if (url.pathname === "/api/publications") {
        if (request.method === "POST") publicationsWritten++;
        payload = {
          channels: [
            {
              id: "fixture-channel",
              platform: "telegram",
              label: "Кофейня Утро",
              username: "fixture",
              status: "connected",
            },
          ],
          publications: [],
          channelLimit: 5,
        };
      } else if (url.pathname === "/api/auth/me")
        payload = { user: { email: h.owner, displayName: "Анна" } };
      else if (url.pathname === "/api/ai-status")
        payload = { connected: false, configured: false, health: "unknown" };
      await cmd("Fetch.fulfillRequest", {
        requestId,
        responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      });
    } catch (error) {
      errors.push(`Fixture: ${error.message}`);
      await cmd("Fetch.fulfillRequest", {
        requestId,
        responseCode: 500,
        body: Buffer.from(JSON.stringify({ error: error.message })).toString(
          "base64",
        ),
      });
    }
  });
  await cmd("Fetch.enable", {
    patterns: [{ urlPattern: `${new URL(base).origin}/api/*` }],
  });
  await cmd("Runtime.enable");
  await cmd("Page.enable");
  const evaluate = async (expression) => {
    const r = await cmd("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description ||
          "Browser evaluation failed",
      );
    return r.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(
      JSON.stringify({
        errors,
        body: await evaluate("document.body.innerText.slice(0,3000)"),
      }),
    );
    const shot = await cmd("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      join(output, "failure.png"),
      Buffer.from(shot.data, "base64"),
    );
    throw new Error(`UI condition not met: ${expression}`);
  };
  const click = async (text) => {
    const found = await evaluate(
      `(() => { const b=[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getClientRects().length&&!b.disabled); if(!b)return false;b.click();return true;})()`,
    );
    if (!found) throw new Error(`Visible button not found: ${text}`);
  };
  const fill = async (selector, value) =>
    evaluate(
      `(() => {const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const screenshot = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const metrics = await evaluate(
      "({width:innerWidth,scroll:document.documentElement.scrollWidth})",
    );
    if (metrics.scroll > metrics.width)
      throw new Error(`Horizontal overflow: ${JSON.stringify(metrics)}`);
    const data = await cmd("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      join(output, `${name}.png`),
      Buffer.from(data.data, "base64"),
    );
  };
  await cmd("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cmd("Page.navigate", { url: `${base}/workspace#start` });
  await until(
    "document.querySelector('.klio-chat-welcome') && !document.querySelector('.klio-chat[hidden]')",
  );
  await click("Только необходимые");
  await evaluate("document.documentElement.setAttribute('data-theme','light')");
  await screenshot("desktop-welcome");
  await fill(
    '[aria-label="Сообщение КЛИО"]',
    "Предложи темы для моего бизнеса",
  );
  await evaluate(
    "document.querySelector('[aria-label=\"Отправить сообщение\"]').click()",
  );
  await until(
    "document.querySelectorAll('.klio-chat-card').length===2 && !document.querySelector('.klio-chat-thinking')",
  );
  await click("В материалы");
  await until(
    "document.querySelector('.klio-chat-notice')?.textContent.includes('Сохранено')",
  );
  await click("Создать пост");
  await until(
    "document.querySelectorAll('.klio-chat-card').length===3 && !document.querySelector('.klio-chat-thinking')",
  );
  await screenshot("desktop-conversation");
  await evaluate(
    "[...document.querySelectorAll('.klio-chat-card')].at(-1).querySelector('.klio-chat-card-actions button').click()",
  );
  await until("document.querySelector('.klio-chat-editor')?.open");
  await fill(
    ".klio-chat-editor textarea",
    "Ручная правка: завтраки каждый день до 12:00.",
  );
  await screenshot("desktop-editor");
  await click("Применить правки");
  await until("!document.querySelector('.klio-chat-editor').open");
  await evaluate(
    "[...document.querySelectorAll('.klio-chat-card')].at(-1).querySelectorAll('.klio-chat-card-actions button')[1].click()",
  );
  await until(
    "[...document.querySelectorAll('.klio-chat-card')].at(-1)?.textContent.includes('В материалах')",
  );
  await click("▤ Материалы");
  await until("document.querySelectorAll('.material-card').length>=2");
  await screenshot("desktop-materials");
  await click("В диалог");
  await until("!document.querySelector('.klio-chat').hidden");
  await until(
    "[...document.querySelectorAll('.klio-chat-card button')].some(b=>b.textContent==='Редактировать'&&!b.disabled)",
  );
  await click("Профессиональный");
  await until(
    "document.querySelector('.workspace-mode-switch button[aria-pressed=true]')?.textContent==='Профессиональный'",
  );
  await click("Диалоговый");
  await until("!document.querySelector('.klio-chat').hidden");
  await until("!document.querySelector('.klio-chat-loading')");
  await cmd("Page.reload");
  await until(
    "document.querySelectorAll('.klio-chat-card').length>=3 && !document.querySelector('.klio-chat').hidden",
  );
  await screenshot("desktop-restored");
  for (const theme of ["light", "dark"]) {
    await cmd("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(
      `document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)})`,
    );
    await screenshot(`mobile-conversation-${theme}`);
  }
  await cmd("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("document.documentElement.setAttribute('data-theme','light')");
  await until(
    "[...document.querySelectorAll('.klio-chat-card button')].some(b=>b.textContent==='Запланировать'&&!b.disabled)",
  );
  await click("Запланировать");
  await until(
    "Boolean(document.querySelector('.publications-editor') || document.querySelector('[aria-labelledby=\"publications-editor-title\"]') || document.body.innerText.includes('Новая публикация'))",
  );
  await screenshot("publication-confirmation");
  if (publicationsWritten)
    throw new Error("A publication was submitted without confirmation");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      passed: true,
      providerCalls: h.calls(),
      materials: (await h.db.select().from(h.schema.generations)).length,
      publicationsWritten,
      screenshots: output,
    }),
  );
  await send("Browser.close");
} finally {
  socket?.close();
  chrome.kill();
  await h.close();
}
