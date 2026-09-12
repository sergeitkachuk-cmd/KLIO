// Read-only public-page smoke check. Uses an isolated Chrome profile; never
// accesses the user's browser cookies or submits authentication/payment data.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] || "http://127.0.0.1:3012";
const workspaceMode = process.argv.includes("--workspace");
if (workspaceMode && !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Workspace fixtures are restricted to a local test server");
const cases = workspaceMode
  ? ["light", "dark"].flatMap(theme => ["/workspace#start", "/workspace#publications"].map(path => ({ path, theme })))
  : ["/", "/examples", "/login", "/signup"].map(path => ({ path, theme: null }));
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const output = mkdtempSync(join(tmpdir(), "klio-browser-check-"));
const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${join(output, "profile")}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome startup timed out")), 15000);
    let stderr = "";
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map();
  let serial = 0;
  let errors = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(message.params.entry.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  if (workspaceMode) {
    // Synthetic read/write API responses isolate UI verification from all
    // real accounts, database changes and paid/external services.
    const account = { planId: "agency", planName: "Тестовый кабинет", generationsUsed: 0, generationLimit: 100, generationsRemaining: 100, researchUsed: 0, researchLimit: 100, researchRemaining: 100, editorActionsUsed: 0, editorActionLimit: 100, editorActionsRemaining: 100, lifetimeGenerationsUsed: 0, lifetimeResearchUsed: 0, lifetimeEditorActionsUsed: 0, daysWithKlio: 1, brandCount: 1, brandLimit: 10, seatLimit: 1, period: new Date().toISOString().slice(0, 7) };
    let brand = { id: "ui-fixture-brand", name: "Проверка интерфейса", profile: { name: "Проверка интерфейса" }, workspace: {}, updatedAt: new Date().toISOString() };
    const user = { email: "ui-audit@example.invalid", displayName: "UI-проверка" };
    socket.addEventListener("message", async event => {
      const message = JSON.parse(event.data);
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      const pathname = new URL(request.url).pathname;
      let payload = {};
      if (pathname === "/api/workspace") {
        if (request.method === "POST") {
          const input = JSON.parse(request.postData || "{}");
          brand = { ...brand, profile: input.profile || brand.profile, workspace: input.workspace || brand.workspace };
          payload = { brand, account };
        } else payload = { user, account, brands: [brand], history: [], materials: [] };
      } else if (pathname === "/api/publications") payload = { channels: [], publications: [], channelLimit: 5 };
      else if (pathname === "/api/auth/me") payload = { user };
      else if (pathname === "/api/ai-status") payload = { connected: false, configured: false, health: "unknown" };
      try { await command("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(payload)).toString("base64") }); }
      catch (error) { errors.push(`Fixture error: ${error.message}`); }
    });
    await command("Fetch.enable", { patterns: [{ urlPattern: `${new URL(base).origin}/api/*` }] });
  }
  await command("Runtime.enable"); await command("Page.enable"); await command("Log.enable");
  for (const width of [1440, 390]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    for (const { path, theme } of cases) {
      errors = [];
      await command("Page.navigate", { url: new URL(path, base).toString() });
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (theme) {
        await command("Runtime.evaluate", { expression: `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); document.querySelector('.publications-day-head > button')?.focus();` });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (width === 390 && path === "/login") {
        await command("Runtime.evaluate", { expression: "window.scrollTo(0, document.documentElement.scrollHeight)" });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const result = await command("Runtime.evaluate", { expression: "JSON.stringify({title:document.title,ready:document.readyState,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,heading:document.querySelector('h1')?.textContent,canonical:document.querySelector('link[rel=canonical]')?.href,robots:document.querySelector('meta[name=robots]')?.content})", returnByValue: true });
      const page = JSON.parse(result.result.value);
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      const filename = join(output, `${width}-${path.replaceAll("/", "").replaceAll("#", "-") || "home"}${theme ? `-${theme}` : ""}.png`);
      writeFileSync(filename, Buffer.from(screenshot.data, "base64"));
      console.log(JSON.stringify({ path, fixture: workspaceMode, ...page, errors, screenshot: filename }));
      if (page.scrollWidth > page.width || errors.some(error => /hydration|content security policy|uncaught/i.test(error))) process.exitCode = 1;
    }
  }
  await send("Browser.close");
} finally {
  socket?.close();
  child.kill();
}
