// Read-only public-page smoke check. Uses an isolated Chrome profile; never
// accesses the user's browser cookies or submits authentication/payment data.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] || "http://127.0.0.1:3012";
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
  await command("Runtime.enable"); await command("Page.enable"); await command("Log.enable");
  for (const width of [1440, 390]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    for (const path of ["/", "/examples", "/login", "/signup"]) {
      errors = [];
      await command("Page.navigate", { url: new URL(path, base).toString() });
      await new Promise(resolve => setTimeout(resolve, 1200));
      const result = await command("Runtime.evaluate", { expression: "JSON.stringify({title:document.title,ready:document.readyState,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,heading:document.querySelector('h1')?.textContent,canonical:document.querySelector('link[rel=canonical]')?.href,robots:document.querySelector('meta[name=robots]')?.content})", returnByValue: true });
      const page = JSON.parse(result.result.value);
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      const filename = join(output, `${width}-${path.replaceAll("/", "") || "home"}.png`);
      writeFileSync(filename, Buffer.from(screenshot.data, "base64"));
      console.log(JSON.stringify({ path, ...page, errors, screenshot: filename }));
      if (page.scrollWidth > page.width || errors.some(error => /hydration|content security policy|uncaught/i.test(error))) process.exitCode = 1;
    }
  }
  await send("Browser.close");
} finally {
  socket?.close();
  child.kill();
}
