// Explicit opt-in smoke test: synthetic content, ephemeral DB, real paid AI calls.
// No real account data, publication or production database is used.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createDialogueHarness } from "../tests/helpers/dialogue-harness.mjs";
import { imageService } from "../services/klio-images/server.mjs";
if (!process.argv.includes("--run") || !process.env.OPENAI_API_KEY?.trim()) throw new Error("Pass --run and configure OPENAI_API_KEY explicitly");
const output = resolve("outputs/dialogue-provider-check"); mkdirSync(output, { recursive: true });
const h = await createDialogueHarness();
const evidence = [];
h.setAi(async input => {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-6-luna", instructions: input.instructions, input: input.input, reasoning: { effort: "low" }, max_output_tokens: 16000, text: { verbosity: "medium", format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } }, store: false }),
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) throw new Error(`Text provider HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== "completed") throw new Error(`Text response status ${payload.status}`);
  const text = payload.output_text || payload.output?.filter(item => item.type === "message" && item.phase !== "commentary").flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("");
  const answer = JSON.parse(text);
  evidence.push({ kind: "text", action: answer.action, durationMs: Date.now() - started, tokens: payload.usage?.total_tokens });
  return answer;
});
const wait = async id => { for (let n=0;n<170;n++) { const {thread}=await h.read(id); if(thread.status!=="processing") { assert.equal(thread.status,"idle",thread.error); return thread; } await new Promise(resolve=>setTimeout(resolve,1000)); } throw new Error("Text smoke test timed out"); };
let service;
try {
  let thread = await h.create();
  await h.post({ action: "send", id: thread.id, revision: thread.revision, requestId: randomUUID(), text: "Для вымышленной кофейни «Утро» предложи три темы постов. Кофе и завтраки до 12:00. Не придумывай акции и цены." });
  thread = await wait(thread.id); assert.equal(thread.data.cards.length,3);
  console.log(JSON.stringify({stage:"topics",...evidence.at(-1)}));
  await h.post({ action:"send",id:thread.id,revision:thread.revision,requestId:randomUUID(),cardId:thread.data.cards[0].id,text:"Напиши отдельный короткий пост по выбранной теме, без выдуманных фактов." });
  thread=await wait(thread.id); assert.ok(thread.data.cards.some(card=>card.kind==="post"));
  console.log(JSON.stringify({stage:"post",...evidence.at(-1)}));
  writeFileSync(resolve(output,"dialogue.json"),JSON.stringify(thread.data,null,2));
  const token=randomUUID()+randomUUID();
  service=imageService({token,apiKey:process.env.OPENAI_API_KEY});
  await new Promise(resolve=>service.listen(0,"127.0.0.1",resolve));
  const started=Date.now();
  const response=await fetch(`http://127.0.0.1:${service.address().port}/generate`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Idempotency-Key":randomUUID()},body:JSON.stringify({prompt:"Editorial photograph of one ceramic coffee cup and a croissant on a pale wooden cafe table, soft morning daylight, clean composition, no text, no logos."}),signal:AbortSignal.timeout(170000)});
  assert.equal(response.status,200,`Image service HTTP ${response.status}`);
  const image=await response.json(); const bytes=Buffer.from(image.data[0].b64_json,"base64");
  assert.ok(bytes.length>1000); writeFileSync(resolve(output,"coffee.png"),bytes);
  evidence.push({kind:"image",durationMs:Date.now()-started,bytes:bytes.length});
  console.log(JSON.stringify(evidence.at(-1)));
  writeFileSync(resolve(output,"evidence.json"),JSON.stringify(evidence,null,2));
} finally { if(service)await new Promise(resolve=>service.close(resolve)); await h.close(); }
