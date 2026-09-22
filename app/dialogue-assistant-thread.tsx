"use client";

// Adapted from assistant-ui's MIT-licensed ChatGPT example. See
// THIRD_PARTY_NOTICES.md. Runtime, input and message primitives are bundled
// with KLIO; no hosted widget, assistant-cloud account or iframe is used.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowDown, ArrowUp, Copy, ImageIcon, Lightbulb, MessageCircle, Plus, SquarePen, X } from "lucide-react";
import { isStandaloneImage, type DialogueCard } from "./dialogue-model";
import { DialogueResultActions, imageDownloadUrl } from "./dialogue-result-actions";
import type { DialogueSession } from "./dialogue-session";

const TOOLS = [
  { id: "chat", label: "Общение", placeholder: "Спросите КЛИО или поставьте задачу", Icon: MessageCircle },
  { id: "topics", label: "Предложить темы", placeholder: "Уточните пожелания к темам (необязательно)", Icon: Lightbulb },
  { id: "text", label: "Написать текст", placeholder: "О чём и для какой площадки написать?", Icon: SquarePen },
  { id: "image", label: "Создать изображение", placeholder: "Опишите изображение", Icon: ImageIcon },
];
function Markdown() { return <MarkdownTextPrimitive className="klio-aui-markdown" smooth={false} />; }
const convertMessage = (message: ThreadMessageLike) => message;

export function DialogueAssistantThread({ session, snapshot, tool, onTool, onSend, onAction, onProfile, busy, options }: {
  session: DialogueSession;
  snapshot: ReturnType<DialogueSession["getSnapshot"]>;
  tool: string | null;
  onTool: (tool: string | null) => void;
  onSend: (text: string, tool?: string) => Promise<boolean>;
  onAction: (type: string, cardId: string, slideIndex?: number) => void;
  onProfile: (messageId: string) => void;
  busy: boolean;
  options: ReactNode;
}) {
  const { thread, loading, sending, draft } = snapshot;
  const running = sending || thread?.status === "processing";
  const sendDisabled = Boolean(loading || busy || running || (snapshot.selectedId && !thread));
  const emptyTopics = tool === "topics" && !draft.trim();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const picker = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const messages = useMemo<ThreadMessageLike[]>(() => (thread?.data.messages || []).map((message) => ({
    id: message.id, role: message.role, content: [{ type: "text", text: message.text }],
    ...(message.role === "assistant" ? { status: { type: "complete" as const, reason: "stop" as const } } : {}),
  })), [thread?.data.messages]);
  const runtime = useExternalStoreRuntime({
    messages, convertMessage, isRunning: running, isLoading: loading,
    isSendDisabled: sendDisabled,
    onNew: async (message) => {
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const sent = await onSend(text);
      if (!sent && !runtime.thread.composer.getState().text) runtime.thread.composer.setText(session.getSnapshot().draft || text);
    },
  });
  useEffect(() => { runtime.thread.composer.setText(draft); }, [draft, runtime]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node)) setMenuOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); picker.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [menuOpen]);
  const activeTool = tool === "carousel" ? { ...TOOLS[3], label: "Карусель", placeholder: "Добавьте текст для слайдов или подробно опишите тему" } : TOOLS.find((item) => item.id === tool) || TOOLS[0];
  const empty = !messages.length && !loading;
  // A revised card may be referenced by several messages. Render its current
  // version once, at the last reference, so result navigation has one target.
  const cardOwners = new Map<string, string>();
  thread?.data.messages.forEach((message) => message.cardIds?.forEach((id) => cardOwners.set(id, message.id)));
  function renderCard(card: DialogueCard) {
    if (!thread) return null;
    const pureImage = isStandaloneImage(thread, card);
    return <article key={card.id} id={`klio-chat-card-${card.id}`} tabIndex={-1} className={`klio-aui-card ${pureImage ? "is-image" : ""}`} aria-label={pureImage ? "Сгенерированное изображение" : card.title}>
      {!pureImage && <><h3>{card.title}</h3><p className="klio-aui-card-body">{card.body}</p></>}
      {card.slides?.length ? <div className="klio-aui-carousel" aria-label={`Карусель: ${card.slides.length} слайдов`}>
        {card.slides.map((slide, index) => <figure key={`${card.id}-${index}`}>
          <button className="klio-aui-image" type="button" aria-label={`Увеличить слайд ${index + 1}`} onClick={() => onAction("klio.open_image", card.id, index)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slide.imageUrl} alt={slide.headline} loading="lazy" />
          </button>
          <figcaption>{index + 1}. {slide.headline}</figcaption>
          <a href={imageDownloadUrl(slide.imageUrl)} download>Скачать слайд</a>
          <button type="button" disabled={busy || running} onClick={() => onAction("klio.refine_image", card.id, index)}>Доработать слайд {index + 1}</button>
        </figure>)}
      </div> : card.imageUrl && <button className="klio-aui-image" type="button" aria-label="Увеличить изображение" onClick={() => onAction("klio.open_image", card.id)}>
        {/* User images retain their actual aspect ratio without a square crop. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.imageUrl} alt={pureImage ? "Сгенерированное изображение" : card.title} loading="lazy" />
      </button>}
      <DialogueResultActions card={card} pureImage={pureImage} busy={busy || running} onAction={(type) => onAction(type, card.id)} />
    </article>;
  }
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className={`klio-aui-root ${empty ? "is-empty" : ""}`}>
      <ThreadPrimitive.Viewport className="klio-aui-viewport" autoScroll>
        {loading && <p className="klio-aui-status" role="status">Загружаем диалог…</p>}
        {empty && <div className="klio-aui-welcome"><h1>Чем я могу помочь?</h1></div>}
        <div className="klio-aui-messages">
          <ThreadPrimitive.Messages>{({ message }) => {
            const original = thread?.data.messages.find((item) => item.id === message.id);
            const cards = thread?.data.cards.filter((card) => cardOwners.get(card.id) === message.id) || [];
            return <MessagePrimitive.Root className={`klio-aui-message is-${message.role}`}>
              {original?.imageSource && <div className="klio-aui-message-source">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={original.imageSource.url} alt={original.imageSource.purpose === "edit" ? "Исходник для доработки" : "Референс"} />
              </div>}
              <div className="klio-aui-message-text"><MessagePrimitive.Parts components={{ Text: Markdown }} /></div>
              {message.role === "assistant" && !cards.length && <button type="button" className="klio-aui-icon klio-aui-copy" aria-label="Копировать ответ" onClick={() => {
                if (!navigator.clipboard?.writeText) { setCopyNotice("Выделите ответ и скопируйте его вручную"); return; }
                void navigator.clipboard.writeText(original?.text || "").then(() => setCopyNotice("Ответ скопирован"), () => setCopyNotice("Выделите ответ и скопируйте его вручную"));
              }}><Copy size={16} /></button>}
              {cards.map(renderCard)}
              {original?.profile && <button type="button" className="klio-aui-profile-apply" disabled={busy || running} onClick={() => onProfile(original.id)}>Применить к профилю бренда</button>}
            </MessagePrimitive.Root>;
          }}</ThreadPrimitive.Messages>
          {thread?.data.cards.filter((card) => !cardOwners.has(card.id)).map(renderCard)}
          {running && <div className="klio-aui-status" role="status"><span className="klio-aui-pulse" />Готовим ответ…</div>}
          {thread?.error && !running && <div className="klio-aui-error" role="alert"><p>{thread.error}</p><button type="button" onClick={() => {
            const last = thread.data.messages.findLast((message) => message.role === "user");
            if (last) {
              session.setDraft(last.text); runtime.thread.composer.setText(last.text);
              if (last.imageSource) { onTool("image"); session.setImageSource({ uploadUrl: last.imageSource.url, purpose: last.imageSource.purpose }); }
            }
          }}>Вернуть сообщение в поле ввода</button></div>}
        </div>
        <ThreadPrimitive.ViewportFooter className="klio-aui-footer">
          {!empty && <ThreadPrimitive.ScrollToBottom className="klio-aui-icon klio-aui-to-bottom" aria-label="К последнему сообщению"><ArrowDown size={18} /></ThreadPrimitive.ScrollToBottom>}
          <ComposerPrimitive.Root className="klio-aui-composer" onSubmit={(event) => {
            // Topic ideation is already specified by the selected mode/settings.
            // Use the same form submission for the button and desktop Enter.
            if (tool !== "topics" || runtime.thread.composer.getState().text.trim()) return;
            event.preventDefault();
            if (!sendDisabled) void onSend("");
          }}>
            <ComposerPrimitive.Input ref={input} className="klio-aui-input" aria-label="Сообщение КЛИО" placeholder={activeTool.placeholder} rows={1} maxLength={8000} autoFocus={false} cancelOnEscape={false} addAttachmentOnPaste={false} unstable_insertNewlineOnTouchEnter onChange={(event) => session.setDraft(event.target.value)} />
            <div className="klio-aui-compose-tools">
              <div className="klio-aui-picker" ref={picker}>
                <button type="button" className="klio-aui-icon" aria-label="Выбрать режим" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Plus size={23} /></button>
                {menuOpen && <div className="klio-aui-tool-menu" aria-label="Режим генерации">
                  {TOOLS.map(({ id, label, Icon }) => <button type="button" key={id} aria-pressed={(tool || "chat") === id || (tool === "carousel" && id === "image")} onClick={() => { onTool(id); setMenuOpen(false); input.current?.focus(); }}><Icon size={18} />{label}</button>)}
                </div>}
              </div>
              {tool && tool !== "chat" && <button type="button" className="klio-aui-tool-chip" onClick={() => onTool(null)} title="Переключиться на обычное общение"><activeTool.Icon size={17} />{activeTool.label}<X size={15} /></button>}
              {emptyTopics
                ? <button type="submit" className="klio-aui-send" aria-label="Отправить сообщение" title="Создать темы по выбранным параметрам" disabled={sendDisabled}><ArrowUp size={21} /></button>
                : <ComposerPrimitive.Send className="klio-aui-send" aria-label="Отправить сообщение"><ArrowUp size={21} /></ComposerPrimitive.Send>}
            </div>
          </ComposerPrimitive.Root>
          {options}
          {empty && <div className="klio-aui-suggestions">
            {TOOLS.slice(1).map(({ id, label, Icon }) => <button type="button" key={id} onClick={() => { onTool(id); input.current?.focus(); }}><Icon size={16} />{label}</button>)}
          </div>}
          <p className="klio-aui-disclaimer">КЛИО может ошибаться. Проверяйте важные факты перед публикацией.</p>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
      <span className="klio-aui-sr" role="status">{copyNotice}</span>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}
