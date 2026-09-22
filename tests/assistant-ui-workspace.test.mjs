import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { mountDialogue, sampleThread } from "./helpers/dialogue-ui.mjs";
import { createDialogueHarness } from "./helpers/dialogue-harness.mjs";

const card = (extra = {}) => ({ id: "card-1", title: "Тема для публикации", body: "Подробное описание темы", kind: "topic", imageUrl: "", versions: [], ...extra });
function withCard(value) { return sampleThread("saved", { data: { messages: [{ id: "a", role: "assistant", text: "Готово", cardIds: [value.id] }], cards: [value] } }); }

test("real assistant-ui renders locally with no domain key, script, iframe or fallback", async (t) => {
  const ui = await mountDialogue(t);
  assert.ok(ui.document.querySelector("textarea.klio-aui-input"));
  assert.ok(ui.document.body.textContent.includes("Чем я могу помочь?"));
  assert.equal(ui.document.querySelector("iframe,script,openai-chatkit"), null);
  await ui.type("Как дела?"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").length, 1);
  assert.equal(ui.calls.find((c) => c.action === "send").mode, "chat");
  assert.equal(ui.calls.find((c) => c.action === "send").useBrandContext, false);
  assert.ok(ui.document.body.textContent.includes("Тестовый ответ"));
});
test("theme changes preserve the thread and unsent composer text", async (t) => {
  const ui = await mountDialogue(t, { threads: [sampleThread()], selected: "saved" });
  await ui.type("Мой черновик"); await ui.render({ theme: "dark" });
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "Мой черновик");
  assert.ok(ui.document.body.textContent.includes("Здравствуйте!"));
  await ui.click(ui.document.querySelector(".klio-chatkit-new"));
  assert.ok(ui.document.body.textContent.includes("Сохранённый диалог"));
  await ui.click(ui.findButton("Сохранённый диалог"));
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "Мой черновик");
});
test("image mode has compact settings and profile checkbox is independent of logo", async (t) => {
  const ui = await mountDialogue(t, { overrides: { brandId: "brand", brandName: "Киностудия", hasLogo: true, brands: [{ id: "brand", name: "Киностудия" }] } });
  await ui.click(ui.findButton("Выбрать режим")); await ui.click(ui.findButton("Создать изображение", ui.document.querySelector(".klio-aui-tool-menu")));
  await ui.click(ui.document.querySelector(".klio-chatkit-settings-toggle"));
  assert.ok(ui.document.body.textContent.includes("Ориентация"));
  assert.ok(ui.document.body.textContent.includes("Логотип на изображении"));
  assert.equal(ui.document.querySelector(".klio-chatkit-brand-context input").checked, false);
  await ui.click(ui.document.querySelector(".klio-chatkit-brand-context input"));
  await ui.type("Творческий процесс на съёмочной площадке"); await ui.click(ui.findButton("Отправить сообщение"));
  const send = ui.calls.find((c) => c.action === "send");
  assert.equal(send.mode, "image"); assert.equal(send.useBrandContext, true);
  assert.equal(send.settings.imageAspectRatio, "4:3"); assert.equal(send.settings.imageOutputFormat, "png");
});
test("failed brand flush keeps the prompt and submits no paid request", async (t) => {
  const ui = await mountDialogue(t, { overrides: { brandId: "brand", beforeProfile: async () => false } });
  await ui.click(ui.document.querySelector(".klio-chatkit-brand-context input")); await ui.type("Текст для бренда");
  await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").length, 0);
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "Текст для бренда");
});
test("result navigation focuses the actual image card and lightbox keeps publication actions", async (t) => {
  const image = card({ kind: "post", body: "", imageUrl: "https://preview.example.invalid/api/uploads/publications/" + "a".repeat(64) + "/00000000-0000-0000-0000-000000000001.png" });
  const ui = await mountDialogue(t, { threads: [withCard(image)], selected: "saved" });
  let jumped = false; const target = ui.document.getElementById("klio-chat-card-card-1"); target.scrollIntoView = () => { jumped = true; };
  await ui.click(ui.document.querySelector(".klio-chatkit-results-trigger"));
  await ui.click(ui.document.querySelector(".klio-chatkit-results-list button"));
  assert.equal(jumped, true); assert.equal(ui.document.activeElement, target);
  assert.equal(ui.document.querySelector('[aria-label="Редактировать материал"]'), null);
  await ui.click(ui.findButton("Увеличить изображение"));
  const viewer = ui.document.querySelector(".image-lightbox-with-actions"); assert.ok(viewer);
  assert.ok(viewer.querySelector('a[download]').href.endsWith("?download=1"));
  await ui.click(ui.findButton("В публикацию", viewer));
  assert.equal(ui.published[0].title, ""); assert.equal(ui.published[0].body, "");
  assert.equal(ui.published[0].imageUrl, image.imageUrl);
});
test("topic cards expose generator, post and image actions with full source context", async (t) => {
  const ui = await mountDialogue(t, { threads: [withCard(card())], selected: "saved" });
  await ui.click(ui.findButton("В генератор")); assert.equal(ui.generated[0].body, "Подробное описание темы");
  await ui.click(ui.findButton("Написать пост"));
  const send = ui.calls.find((c) => c.action === "send");
  assert.equal(send.mode, "text"); assert.equal(send.settings.format, "social"); assert.ok(send.text.includes("Подробное описание темы"));
});
test("history rename and confirmed deletion keep saved Materials intact", async (t) => {
  const ui = await mountDialogue(t, { threads: [sampleThread()], selected: "saved" });
  await ui.click(ui.document.querySelector(".klio-chatkit-thread-more")); await ui.click(ui.findButton("Переименовать"));
  await ui.type("Новое название", ui.document.querySelector('[aria-label="Название диалога"]'));
  await ui.click(ui.findButton("Сохранить")); assert.equal(ui.records.get("saved").title, "Новое название");
  await ui.click(ui.document.querySelector(".klio-chatkit-thread-more")); await ui.click(ui.findButton("Удалить"));
  assert.ok(ui.document.querySelector('[role="alertdialog"]'));
  await ui.click(ui.document.querySelector('[data-action="delete"]'));
  assert.equal(ui.records.has("saved"), false); assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "");
  assert.equal(ui.calls.filter((c) => c.action === "delete").length, 1);
});
test("failed delete leaves confirmation and selected conversation intact", async (t) => {
  const ui = await mountDialogue(t, { threads: [sampleThread()], selected: "saved", fetchOverride: async (_, __, body) => body?.action === "delete" ? Response.json({ error: "Диалог изменён в другой вкладке" }, { status: 409 }) : null });
  await ui.click(ui.document.querySelector(".klio-chatkit-thread-more")); await ui.click(ui.findButton("Удалить")); await ui.click(ui.document.querySelector('[data-action="delete"]'));
  assert.ok(ui.document.querySelector('[role="alertdialog"]')); assert.ok(ui.records.has("saved"));
});
test("failed jobs restore the last prompt without automatically generating again", async (t) => {
  const ui = await mountDialogue(t, { threads: [sampleThread("saved", { status: "failed", error: "Не удалось завершить ответ" })], selected: "saved" });
  await ui.click(ui.findButton("Вернуть сообщение в поле ввода"));
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "Привет"); assert.equal(ui.calls.filter((c) => c.action === "send").length, 0);
});
test("settings close with Escape and blocked local storage still permits chat", async (t) => {
  const ui = await mountDialogue(t, { blockedStorage: true });
  await ui.click(ui.findButton("Создать изображение")); await ui.click(ui.document.querySelector(".klio-chatkit-settings-toggle"));
  await React.act(async () => ui.document.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(ui.document.querySelector(".klio-chatkit-settings-popover"), null);
  await ui.click(ui.findButton("Выбрать режим")); await ui.click(ui.findButton("Общение"));
  await ui.type("Привет"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.find((c) => c.action === "send").mode, "chat");
});
test("text settings do not leak into ordinary conversation after clearing the mode", async (t) => {
  const ui = await mountDialogue(t);
  await ui.click(ui.findButton("Написать текст")); await ui.click(ui.document.querySelector(".klio-chatkit-settings-toggle"));
  const fields = ui.document.querySelectorAll(".klio-chatkit-settings-popover .module-select button");
  await ui.click(fields[0]); await ui.click(ui.findButton("SEO-статья"));
  await ui.type("Напиши статью про съёмку"); await ui.click(ui.findButton("Отправить сообщение"));
  const first = ui.calls.find((c) => c.action === "send"); assert.equal(first.settings.format, "seo");
  await ui.click(ui.findButton("Выбрать режим")); await ui.click(ui.findButton("Общение"));
  await ui.type("А какая сегодня погода?"); await ui.click(ui.findButton("Отправить сообщение"));
  const last = ui.calls.filter((c) => c.action === "send").at(-1); assert.equal(last.mode, "chat"); assert.deepEqual(last.settings, {});
});
test("topics mode submits a chosen count and never silently switches to generic chat", async (t) => {
  const ui = await mountDialogue(t);
  await ui.click(ui.findButton("Предложить темы")); await ui.click(ui.document.querySelector(".klio-chatkit-settings-toggle"));
  const fields = ui.document.querySelectorAll(".klio-chatkit-settings-popover .module-select button");
  await ui.click(fields[1]); await ui.click(ui.findButton("8")); await ui.type("Темы для блога студии"); await ui.click(ui.findButton("Отправить сообщение"));
  const send = ui.calls.find((c) => c.action === "send"); assert.equal(send.mode, "topics"); assert.equal(send.settings.topicCount, "8");
  assert.equal(send.text, "Темы для блога студии");
});

test("topics run from an empty composer with brand, social format and three results", async (t) => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  await h.db.insert(h.schema.brands).values({ id: "studio", ownerEmail: h.owner, name: "Киностудия", profileJson: JSON.stringify({ services: "Съёмка видеоподкастов" }) });
  let context;
  h.setAi(async (input) => {
    context = JSON.parse(input.input);
    return { reply: "Вот три темы.", action: "create", profile: [], cards: Array.from({ length: 3 }, (_, i) => ({ kind: "topic", title: `Тема ${i + 1}`, body: "Расскажите о процессе съёмки видеоподкаста." })) };
  });
  const ui = await mountDialogue(t, {
    overrides: { brandId: "studio", brandName: "Киностудия" },
    fetchOverride: async (url, _, body) => body ? h.request(body) : h.route.GET(new Request(`http://127.0.0.1:3027${url}`)),
  });
  await ui.click(ui.findButton("Предложить темы"));
  await ui.click(ui.document.querySelector(".klio-chatkit-brand-context input"));
  await ui.click(ui.document.querySelector(".klio-chatkit-settings-toggle"));
  const fields = ui.document.querySelectorAll(".klio-chatkit-settings-popover .module-select button");
  await ui.click(fields[0]); await ui.click(ui.findButton("Пост для соцсетей"));
  await ui.click(fields[1]); await ui.click(ui.findButton("3"));
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "");
  assert.equal(ui.calls.filter((c) => c.action === "send").length, 0);
  assert.equal(ui.findButton("Отправить сообщение").disabled, false);
  await ui.click(ui.findButton("Отправить сообщение"));
  const sends = ui.calls.filter((c) => c.action === "send");
  assert.equal(sends.length, 1); assert.equal(sends[0].mode, "topics");
  assert.equal(sends[0].useBrandContext, true);
  assert.deepEqual(sends[0].settings, { format: "social", topicCount: "3" });
  const settled = await h.settled(sends[0].id);
  assert.equal(settled.status, "idle"); assert.equal(settled.data.cards.length, 3);
  assert.ok(JSON.stringify(context).includes("Съёмка видеоподкастов"));
  assert.equal((await h.account()).researchUsed, 1);
});

test("empty topics support Enter without a brand; other modes still need a message", async (t) => {
  const ui = await mountDialogue(t);
  assert.equal(ui.findButton("Отправить сообщение").disabled, true);
  await ui.click(ui.findButton("Предложить темы"));
  await ui.type("   ");
  await React.act(async () => ui.document.querySelector("textarea.klio-aui-input").dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  const sends = ui.calls.filter((c) => c.action === "send");
  assert.equal(sends.length, 1); assert.equal(sends[0].mode, "topics");
  assert.equal(sends[0].useBrandContext, false); assert.ok(sends[0].text.trim());
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "");
  await ui.click(ui.findButton("Выбрать режим")); await ui.click(ui.findButton("Общение"));
  assert.equal(ui.findButton("Отправить сообщение").disabled, true);
  for (const mode of ["Создать изображение", "Написать текст"]) {
    await ui.click(ui.findButton("Выбрать режим"));
    await ui.click(ui.findButton(mode, ui.document.querySelector(".klio-aui-tool-menu")));
    assert.equal(ui.findButton("Отправить сообщение").disabled, true);
  }
  assert.equal(ui.calls.filter((c) => c.action === "send").length, 1);
});

test("empty topics retain settings for retry when saving the brand fails", async (t) => {
  let saved = false;
  const ui = await mountDialogue(t, { overrides: { brandId: "studio", beforeProfile: async () => saved } });
  await ui.click(ui.findButton("Предложить темы"));
  await ui.click(ui.document.querySelector(".klio-chatkit-brand-context input"));
  await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").length, 0);
  assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "");
  assert.ok(ui.document.querySelector(".klio-aui-tool-chip").textContent.includes("Предложить темы"));
  saved = true;
  await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").length, 1);
});

test("new dialogue clears failed topics mode and chat never silently becomes research", async (t) => {
  const ui = await mountDialogue(t, { overrides: { researchRemaining: 0, dialogueRemaining: 50 }, fetchOverride: async (_, __, body) => body?.action === "send" && body.mode === "topics" ? Response.json({ error: "Лимит исследований исчерпан" }, { status: 429 }) : null });
  await ui.click(ui.findButton("Предложить темы")); await ui.click(ui.findButton("Отправить сообщение"));
  await ui.click(ui.document.querySelector(".klio-chatkit-new"));
  assert.equal(ui.document.querySelector(".klio-aui-tool-chip"), null);
  await ui.type("Расскажи, как подбирать темы для контента"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").at(-1).mode, "chat");
  assert.ok(ui.document.body.textContent.includes("Тестовый ответ"));
});

test("image mode persists for another variant and explicit chat still permits discussing images", async (t) => {
  const ui = await mountDialogue(t);
  await ui.type("Нарисуй картинку съёмочного процесса"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.ok(ui.document.querySelector(".klio-aui-tool-chip").textContent.includes("Создать изображение"));
  await ui.type("Сделай ещё один вариант"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.deepEqual(ui.calls.filter((c) => c.action === "send").map((c) => c.mode), ["image", "image"]);
  await ui.click(ui.findButton("Выбрать режим")); await ui.click(ui.findButton("Общение"));
  await ui.type("Нарисуй картинку — это хорошая формулировка?"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").at(-1).mode, "chat");
  await ui.click(ui.document.querySelector(".klio-chatkit-new"));
  await ui.type("Как создать картинку?"); await ui.click(ui.findButton("Отправить сообщение"));
  assert.equal(ui.calls.filter((c) => c.action === "send").at(-1).mode, "chat");
});

test("a forgotten generation mode yields to conversation and drops generation settings", async (t) => {
  const ui = await mountDialogue(t, { overrides: { researchRemaining: 0 } });
  for (const label of ["Предложить темы", "Создать изображение", "Написать текст"]) {
    await ui.click(ui.findButton("Выбрать режим")); await ui.click(ui.findButton(label, ui.document.querySelector(".klio-aui-tool-menu")));
    await ui.type("А почему ты считаешь это хорошей идеей?"); await ui.click(ui.findButton("Отправить сообщение"));
    const send = ui.calls.filter(c => c.action === "send").at(-1);
    assert.equal(send.mode, "chat"); assert.deepEqual(send.settings, {});
    assert.equal(ui.document.querySelector(".klio-aui-tool-chip"), null);
    assert.match(ui.document.querySelector(".klio-aui-quota").textContent, /Общение/);
  }
});

test("Refine chooses the clicked older image without generating and submits that exact source", async (t) => {
  const oldImage = card({ id: "old", body: "", kind: "post", imageUrl: "https://preview.example.invalid/old.png" });
  const newerImage = card({ id: "newer", body: "", kind: "post", imageUrl: "https://preview.example.invalid/newer.png" });
  const row = sampleThread("saved", { data: { cards: [oldImage, newerImage], messages: [{ id: "a1", role: "assistant", text: "Готово", cardIds: ["old"] }, { id: "a2", role: "assistant", text: "Готово", cardIds: ["newer"] }] } });
  const ui = await mountDialogue(t, { threads: [row], selected: "saved" });
  await ui.click(ui.findButton("Доработать", ui.document.getElementById("klio-chat-card-old")));
  assert.equal(ui.calls.filter(c => c.action === "send").length, 0);
  assert.equal(ui.document.querySelector(".klio-aui-attachment-preview img").src, oldImage.imageUrl);
  await ui.type("Убери провод на столе"); await ui.click(ui.findButton("Отправить сообщение"));
  const send = ui.calls.find(c => c.action === "send");
  assert.equal(send.mode, "image"); assert.deepEqual(send.imageSource, { cardId: "old", purpose: "edit" });
  assert.equal(ui.document.querySelector(".klio-aui-attachment-preview"), null);
  assert.equal(ui.records.get("saved").data.cards[0].imageUrl, oldImage.imageUrl);
});

test("new conversations do not inherit an attached reference", async (t) => {
  const value = card({ kind: "post", body: "", imageUrl: "https://preview.example.invalid/image.png" });
  const ui = await mountDialogue(t, { threads: [withCard(value)], selected: "saved" });
  await ui.click(ui.findButton("Доработать"));
  await ui.click(ui.document.querySelector(".klio-chatkit-new"));
  assert.equal(ui.document.querySelector(".klio-aui-attachment-preview"), null);
  await ui.type("Привет!"); await ui.click(ui.findButton("Отправить сообщение"));
  const send = ui.calls.find(c => c.action === "send");
  assert.equal(send.mode, "chat"); assert.equal(send.imageSource, undefined);
});

test("uploading a reference attaches the stored file without triggering a paid generation", async (t) => {
  const url = "https://preview.example.invalid/api/uploads/publications/" + "a".repeat(64) + "/00000000-0000-0000-0000-000000000001.png";
  const ui = await mountDialogue(t, { fetchOverride: async (path, init) => {
    if (path !== "/api/uploads") return null;
    assert.equal(init.body.get("file").name, "reference.png"); return Response.json({ url }, { status: 201 });
  } });
  await ui.click(ui.findButton("Создать изображение"));
  const input = ui.document.querySelector('[aria-label="Загрузить референс"]');
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], "reference.png", { type: "image/png" })] });
  await React.act(async () => input.dispatchEvent(new ui.window.Event("change", { bubbles: true })));
  assert.equal(ui.calls.filter(c => c.action === "send").length, 0);
  assert.equal(ui.document.querySelector(".klio-aui-attachment-preview img").src, url);
  await ui.type("Интерьер в таком стиле"); await ui.click(ui.findButton("Отправить сообщение"));
  const send = ui.calls.find(c => c.action === "send");
  assert.deepEqual(send.imageSource, { uploadUrl: url, purpose: "reference" });
});

test("carousel image settings save all slides, preview the selected slide and publish one whole material", async (t) => {
  const h = await createDialogueHarness(); t.after(() => h.close());
  await h.db.insert(h.schema.brands).values({ id: "studio", ownerEmail: h.owner, name: "Киностудия", profileJson: JSON.stringify({ services: "Съёмка видеоподкастов", logoKey: "logo" }) });
  let seen;
  h.setAi(async (input) => { seen = input; return { slides: Array.from({ length: 3 }, (_, i) => ({ headline: `Съёмка ${i + 1}`, subtext: "Расскажите о подготовке видеоподкаста и работе со светом." })) }; });
  const ui = await mountDialogue(t, {
    overrides: { brandId: "studio", hasLogo: true },
    fetchOverride: async (url, _, body) => body ? h.request(body) : h.route.GET(new Request(`http://127.0.0.1:3027${url}`)),
  });
  await ui.click(ui.findButton("Создать изображение"));
  await ui.click(ui.document.querySelector(".klio-chatkit-brand-context input"));
  await ui.click(ui.document.querySelector(".klio-chatkit-settings-toggle"));
  const select = async (label, value) => {
    const field = [...ui.document.querySelectorAll(".klio-chatkit-settings-popover .module-select")].find((node) => node.textContent.includes(label));
    assert.ok(field); await ui.click(field.querySelector("button")); await ui.click(ui.findButton(value));
  };
  await select("Результат", "Карусель"); await select("Количество слайдов", "3");
  await select("Ориентация", "Портретная"); await select("Формат файла", "WEBP");
  await ui.click(ui.document.querySelector(".klio-chatkit-settings-logo input"));
  await ui.type("Подготовка видеоподкаста: спланируйте разговор, настройте свет, проверьте звук и камеры.");
  await ui.click(ui.findButton("Отправить сообщение"));
  const send = ui.calls.find((c) => c.action === "send"); assert.equal(send.mode, "carousel");
  const settled = await h.settled(send.id);
  assert.equal(settled.data.cards[0].slides.length, 3);
  assert.equal((await h.account()).generationsUsed, 3);
  assert.equal(h.carouselCalls.length, 3);
  assert.equal(h.carouselCalls[0][5].aspectRatio, "9:16"); assert.equal(h.carouselCalls[0][5].outputFormat, "webp");
  assert.ok(h.carouselCalls[0][1]);
  assert.equal(JSON.parse(seen.input).profile.services, "Съёмка видеоподкастов");
  await React.act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
  assert.equal(ui.document.querySelectorAll(".klio-aui-carousel figure").length, 3);
  await ui.click(ui.findButton("Увеличить слайд 2"));
  assert.ok([...ui.document.querySelectorAll('[role="dialog"] img')].some((img) => img.src === settled.data.cards[0].slides[1].imageUrl));
  await ui.click(ui.findButton("В публикацию", ui.document.querySelector('[role="dialog"]')));
  assert.equal(ui.published.length, 1); assert.equal(ui.published[0].body, "");
  const materials = await h.db.select().from(h.schema.generations);
  assert.equal(materials.length, 1); assert.equal(materials[0].topic, "Карусель");
  assert.equal(ui.published[0].generationId, materials[0].id);
  assert.equal(JSON.parse(materials[0].slidesJson).length, 3);
  assert.equal((await h.db.select().from(h.schema.publications)).length, 0);
});
test("switching business cannot retain another business's thread or brand flag", async (t) => {
  const ui = await mountDialogue(t, { threads: [sampleThread("one", { brandId: "one" }), sampleThread("two", { brandId: "two" })], selected: "one", overrides: { brandId: "one" } });
  await ui.click(ui.document.querySelector(".klio-chatkit-brand-context input")); await ui.type("Только для первого бренда");
  await ui.render({ brandId: "two" }); assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "");
  assert.equal(ui.document.querySelector(".klio-chatkit-brand-context input").checked, false);
  assert.ok(ui.document.querySelector(".klio-aui-welcome"));
  await ui.render({ brandId: "one" }); assert.equal(ui.document.querySelector("textarea.klio-aui-input").value, "Только для первого бренда");
});
test("manual material edits can be saved again and stale edits do not overwrite a newer card", async (t) => {
  const c = card({ kind: "post", savedId: "material", savedSnapshot: { title: "Old title", body: "Old body", imageUrl: "" } });
  const ui = await mountDialogue(t, { threads: [withCard(c)], selected: "saved" });
  assert.equal(ui.findButton("Обновить материал").disabled, false);
  await ui.click(ui.findButton("Редактировать"));
  const modal = ui.document.querySelector('[aria-label="Редактировать материал"]');
  await ui.type("Ручные правки", modal.querySelector("textarea"));
  ui.records.get("saved").data.cards[0].body = "Правки из другой вкладки";
  await ui.click(ui.findButton("Сохранить", modal));
  assert.equal(ui.calls.filter((c) => c.action === "edit").length, 0);
  assert.equal(modal.querySelector("textarea").value, "Ручные правки");
  assert.ok(modal.textContent.includes("Материал изменён"));
});
test("failed history refresh preserves existing rows and exposes retry", async (t) => {
  let fail = false;
  const ui = await mountDialogue(t, { threads: [sampleThread()], selected: "saved", fetchOverride: async (url, _, body) => !body && !url.includes("id=") && fail ? Response.json({ error: "Offline" }, { status: 503 }) : null });
  fail = true; await ui.click(ui.document.querySelector(".klio-chatkit-new"));
  assert.ok(ui.document.querySelector(".klio-chatkit-recent").textContent.includes("Сохранённый диалог"));
  assert.ok(ui.findButton("Повторить")); fail = false; await ui.click(ui.findButton("Повторить"));
  assert.equal(ui.document.querySelector(".klio-chatkit-recent-error"), null);
});
test("full history loads additional pages and closes with Escape", async (t) => {
  const ui = await mountDialogue(t, { fetchOverride: async (url, _, body) => {
    if (body || url.includes("id=")) return null;
    return Response.json(url.includes("before=") ? { threads: [sampleThread("older", { title: "Старый диалог" })], next: null } : { threads: [sampleThread()], next: "2026-09-01" });
  } });
  await ui.click(ui.findButton("Вся история")); await React.act(async () => { await new Promise((r) => setTimeout(r, 15)); });
  await ui.click(ui.findButton("Загрузить ещё")); assert.ok(ui.document.querySelector('[role="dialog"][aria-label="История диалогов"]').textContent.includes("Старый диалог"));
  await React.act(async () => ui.document.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(ui.document.querySelector('[role="dialog"][aria-label="История диалогов"]'), null);
});
test("assistant Markdown escapes HTML and unsafe links", async (t) => {
  const ui = await mountDialogue(t, { threads: [sampleThread("saved", { data: { cards: [], messages: [{ id: "a", role: "assistant", text: '<script>alert(1)</script>\n\n[click](javascript:alert%281%29)\n\n**Безопасный текст**' }] } })], selected: "saved" });
  assert.equal(ui.document.querySelector("script"), null);
  assert.equal(ui.document.querySelector('a[href^="javascript:"]'), null);
  assert.equal(ui.document.querySelector(".klio-aui-markdown strong").textContent, "Безопасный текст");
});
test("mobile rail controls and profile-import actions remain available", async (t) => {
  const row = sampleThread("saved", { data: { cards: [], messages: [{ id: "profile", role: "assistant", text: "Предложение профиля", profile: { voice: "Спокойный" } }] } });
  const ui = await mountDialogue(t, { threads: [row], selected: "saved" });
  await ui.click(ui.findButton("Открыть меню КЛИО")); assert.ok(ui.document.querySelector(".rail-open"));
  await ui.click(ui.document.querySelector(".klio-chatkit-backdrop")); assert.equal(ui.document.querySelector(".rail-open"), null);
  await ui.click(ui.findButton("Применить к профилю бренда")); assert.equal(ui.calls.find((c) => c.action === "profile").messageId, "profile");
  await ui.render({ importMaterial: { id: "material", nonce: 1 } }); await ui.render({ theme: "dark" });
  assert.equal(ui.calls.filter((c) => c.action === "import").length, 1);
});
test("actual UI -> dialogue route -> isolated database preserves image material and publication draft", async (t) => {
  const h = await createDialogueHarness(); t.after(() => h.close()); const row = await h.create();
  const ui = await mountDialogue(t, { selected: row.id, fetchOverride: async (url, _, body) => body ? h.request(body) : h.route.GET(new Request(`http://127.0.0.1:3027${url}`)) });
  await ui.click(ui.findButton("Создать изображение")); await ui.type("Рассвет над лесом"); await ui.click(ui.findButton("Отправить сообщение"));
  const settled = await h.settled(row.id); assert.equal(settled.data.cards.length, 1);
  await React.act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
  assert.ok(ui.findButton("Увеличить изображение"));
  assert.equal(h.imageCalls.length, 1); assert.equal((await h.account()).generationsUsed, 1);
  await ui.click(ui.findButton("В публикацию"));
  assert.equal(ui.published.length, 1); assert.equal(ui.published[0].body, "");
  const saved = await h.db.select().from(h.schema.generations); assert.equal(saved.length, 1); assert.equal(saved[0].id, ui.published[0].generationId);
  assert.equal((await h.db.select().from(h.schema.publications)).length, 0);
});
test("applying a new business profile preserves the active conversation in its new space", async (t) => {
  const row = sampleThread("saved", { data: { cards: [], messages: [{ id: "profile", role: "assistant", text: "Профиль", profile: { name: "Студия" } }] } });
  const ui = await mountDialogue(t, { threads: [row], selected: "saved", fetchOverride: async (_, __, body, records) => {
    if (body?.action !== "profile") return null;
    const moved = records.get("saved"); moved.brandId = "new-brand"; moved.revision++;
    return Response.json({ thread: moved, brand: { id: "new-brand", name: "Студия" } });
  } });
  await ui.click(ui.findButton("Применить к профилю бренда"));
  assert.equal(ui.profiled[0].id, "new-brand");
  assert.equal(ui.window.localStorage.getItem("klio-chatkit:test-user:personal"), null);
  assert.equal(ui.window.localStorage.getItem("klio-chatkit:test-user:new-brand"), "saved");
  await ui.render({ brandId: "new-brand" }); assert.equal(ui.document.querySelector(".klio-aui-welcome"), null);
});
