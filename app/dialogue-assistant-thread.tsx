"use client";

// Adapted from assistant-ui's MIT-licensed ChatGPT example. See
// THIRD_PARTY_NOTICES.md. Runtime, input and message primitives are bundled
// with KLIO; no hosted widget, assistant-cloud account or iframe is used.
import Image from "next/image";
import { KlioResponseActivity } from "./klio-activity";
import "./dialogue-card-photos.css";
import { HelpTip } from "./help-tip";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowDown, ArrowUp, Copy, ImageIcon, Images, Lightbulb, MessageCircle, SquarePen, X } from "lucide-react";
import { isStandaloneImage, type DialogueCard } from "./dialogue-model";
import { DialogueResultActions, imageDownloadUrl } from "./dialogue-result-actions";
import { DialogueWritingField } from "./dialogue-writing-field";
import type { DialogueSession } from "./dialogue-session";

const TOOLS = [
  { id: "chat", label: "Общение", placeholder: "Спросите КЛИО или поставьте задачу", Icon: MessageCircle },
  { id: "topics", label: "Предложить темы", description: "Найдём идею для вашей истории", placeholder: "Уточните пожелания к темам (необязательно)", Icon: Lightbulb },
  { id: "text", label: "Написать текст", description: "От первого слова до публикации", placeholder: "О чём и для какой площадки написать?", Icon: SquarePen },
  { id: "image", label: "Создать изображение", description: "Придадим вашему замыслу форму", placeholder: "Опишите изображение", Icon: ImageIcon },
  { id: "carousel", label: "Создать карусель", description: "Соберём мысли в серию слайдов", placeholder: "Опишите тему или дайте текст для слайдов", Icon: Images },
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
  const viewport = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(running);
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
  useEffect(() => {
    const composer = runtime.thread.composer;
    // The composer already owns keystrokes while the user is typing. Writing
    // the same draft back on every external-store update can reset the native
    // selection/caret in assistant-ui inputs. Only apply genuinely external
    // draft changes (thread switches, restored drafts, failed sends).
    if (composer.getState().text !== draft) composer.setText(draft);
  }, [draft, runtime]);
  useEffect(() => {
    const justCompleted = wasRunning.current && !running;
    wasRunning.current = running;
    if (!justCompleted) return;
    const container = viewport.current;
    const assistants = container?.querySelectorAll<HTMLElement>(".klio-aui-message.is-assistant");
    const target = assistants?.[assistants.length - 1];
    if (!container || !target) return;
    const frame = window.requestAnimationFrame(() => {
      const targetOffset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      const top = Math.max(0, container.scrollTop + targetOffset - 12);
      try {
        if (typeof container.scrollTo === "function") container.scrollTo({ top, behavior: "smooth" });
        else container.scrollTop = top;
      } catch {
        container.scrollTop = top;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [running, thread?.id, thread?.revision]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node)) setMenuOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); picker.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [menuOpen]);
  const activeTool = TOOLS.find((item) => item.id === tool) || TOOLS[0];
  const empty = !messages.length && !loading && !running;
  const composerPanel = useRef<HTMLDivElement>(null);
  const previousPosition = useRef<{ empty: boolean; top: number } | null>(null);
  const dockingAnimation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const panel = composerPanel.current;
    if (!panel) return;
    const top = panel.getBoundingClientRect().top;
    const previous = previousPosition.current;
    if (previous?.empty && !empty && typeof panel.animate === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const footer = panel.closest<HTMLElement>(".klio-aui-footer");
      if (footer) {
        dockingAnimation.current?.cancel();
        footer.style.willChange = "transform";
        const animation = footer.animate([
          { transform: `translate3d(0,${previous.top - top}px,0)` },
          { transform: "translate3d(0,0,0)" },
        ], { duration: 360, easing: "cubic-bezier(.4,0,.2,1)" });
        dockingAnimation.current = animation;
        const finish = () => {
          if (dockingAnimation.current !== animation) return;
          footer.style.willChange = "";
          dockingAnimation.current = null;
        };
        // Cancellation on navigation rejects finished; handle both outcomes.
        void animation.finished.then(finish, finish);
      }
    }
    previousPosition.current = { empty, top };
  }, [empty]);

  useEffect(() => () => { dockingAnimation.current?.cancel(); }, []);

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
      <ThreadPrimitive.Viewport ref={viewport} className="klio-aui-viewport" autoScroll={!empty}>
        {loading && <p className="klio-aui-status" role="status">Загружаю диалог…</p>}
        {empty && <div className="klio-aui-welcome">
          <div className="klio-glass-floating-ideas" aria-label="Предложения для начала диалога">
            <button type="button" className="klio-glass-floating-card is-story" onClick={() => { session.setDraft("Помоги рассказать историю моего бренда"); onTool("text"); input.current?.focus(); }}>
              <span>История бренда</span><small>Найти свои слова</small>
              <span className="klio-card-photo-frame is-floating"><Image src="/dialogue/card-photos/writing.jpg" alt="" fill sizes="140px" unoptimized/></span>
            </button>
            <button type="button" className="klio-glass-floating-card is-visual" onClick={() => { session.setDraft("Помоги придумать визуальную концепцию для моего бренда"); onTool("image"); input.current?.focus(); }}>
              <span>Визуальная идея</span><small>Посмотреть иначе</small>
              <span className="klio-card-photo-frame is-floating"><Image src="/dialogue/card-photos/ocean.jpg" alt="" fill sizes="140px" unoptimized/></span>
            </button>
          </div>
          <h1>Приступим<span>?</span></h1>
        </div>}
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
          <KlioResponseActivity running={running}/>
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
          {empty && <div className="klio-aui-suggestions" aria-label="Начать с инструмента">
            {TOOLS.slice(1).map(({ id, label, ...item }) => <button type="button" className="klio-glass-tool-card" data-tool={id} aria-label={label} aria-pressed={tool === id} key={id} onClick={() => { onTool(id); input.current?.focus(); }}>
              <span className="klio-glass-tool-name">{label}</span>
              <span className="klio-glass-tool-description">{"description" in item ? String(item.description) : ""}</span>
              <span className={`klio-card-photo-frame is-${id}`} aria-hidden="true">
                <Image src={`/dialogue/card-photos/${id === "topics" ? "ideas" : id === "text" ? "writing" : id === "image" ? "ocean" : "architecture"}.jpg`} alt="" fill sizes="(max-width: 720px) 100px, 140px" unoptimized/>
                {id === "carousel" && <span className="klio-card-photo-pages"><i/><i/><i/></span>}
              </span>
              <span className="klio-glass-tool-arrow" aria-hidden="true">↗</span>
            </button>)}
          </div>}
          <div ref={composerPanel} className="klio-glass-input-panel">
          <ComposerPrimitive.Root className="klio-aui-composer" onSubmitCapture={() => {
            if (empty && composerPanel.current) previousPosition.current = { empty: true, top: composerPanel.current.getBoundingClientRect().top };
          }} onSubmit={(event) => {
            // Topic ideation is already specified by the selected mode/settings.
            // Use the same form submission for the button and desktop Enter.
            if (tool !== "topics" || runtime.thread.composer.getState().text.trim()) return;
            event.preventDefault();
            if (!sendDisabled) void onSend("");
          }}>
            <DialogueWritingField inputRef={input} value={draft}>
            <ComposerPrimitive.Input ref={input} className="klio-aui-input" aria-label="Сообщение КЛИО" placeholder={activeTool.placeholder} rows={1} maxLength={8000} autoFocus={false} cancelOnEscape={false} addAttachmentOnPaste={false} unstable_insertNewlineOnTouchEnter onChange={(event) => {
              // ComposerPrimitive.Input composes this callback before it writes
              // the new value to its own store. Deferring our external draft
              // update prevents an intermediate render with the previous
              // composer value, which moves the caret to the end in the middle
              // of an edited message.
              const nextDraft = event.target.value;
              queueMicrotask(() => session.setDraft(nextDraft));
            }} />
            </DialogueWritingField>
            <div className="klio-aui-compose-tools">
              <div className="klio-aui-picker" ref={picker}>
                <button type="button" className="klio-aui-icon" aria-label="Открыть меню задач" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><svg className="klio-aui-tool-menu-icon" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="7" r="4"/><circle cx="17" cy="7" r="4"/><circle cx="7" cy="17" r="4"/><circle cx="17" cy="17" r="4"/></svg></button>
                {menuOpen && <div className="klio-aui-tool-menu" aria-label="Режим генерации">
                  {TOOLS.map(({ id, label, Icon }) => <button type="button" key={id} aria-pressed={(tool || "chat") === id} onClick={() => { onTool(id); setMenuOpen(false); input.current?.focus(); }}><Icon size={18} />{label}</button>)}
                </div>}
              </div>
              {tool && tool !== "chat" && <button type="button" className="klio-aui-tool-chip" onClick={() => onTool(null)} title="Переключиться на обычное общение"><activeTool.Icon size={17} />{activeTool.label}<X size={15} /></button>}
              {emptyTopics
                ? <button type="submit" className="klio-aui-send" aria-label="Отправить сообщение" title="Создать темы по выбранным параметрам" disabled={sendDisabled}><ArrowUp size={21} /></button>
                : <ComposerPrimitive.Send className="klio-aui-send" aria-label="Отправить сообщение"><ArrowUp size={21} /></ComposerPrimitive.Send>}
            </div>
          </ComposerPrimitive.Root>
          </div>
          {options}
          <div className="klio-aui-disclaimer klio-quiet-note"><HelpTip label="О точности ответов КЛИО" text="КЛИО может ошибаться. Проверяйте важные факты перед публикацией."/></div>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
      <span className="klio-aui-sr" role="status">{copyNotice}</span>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}
