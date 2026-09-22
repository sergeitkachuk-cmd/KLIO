"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { DialogueAssistantThread } from "./dialogue-assistant-thread";
import { createDialogueSession } from "./dialogue-session";
import { DialogueHistory } from "./dialogue-history";
import { DialogueModal } from "./dialogue-modal";
import { isStandaloneImage, type DialogueCard, type DialogueThread } from "./dialogue-model";
import { ModuleSelect } from "./module-select";
import { DialogueRecentThreads } from "./dialogue-recent-threads";
import { DialogueThreadDialog, type ThreadAction } from "./dialogue-thread-actions";
import { DialogueSettingsPopover } from "./dialogue-settings-popover";
import { DialogueResultsMenu } from "./dialogue-results-menu";
import { DialogueResultPreview } from "./dialogue-result-preview";
import { DialogueResultActions } from "./dialogue-result-actions";
import { ImageLightbox } from "./image-lightbox";
import { isImageEditRequest, requestedLogoChange, resolveDialogueTool, TOPICS_STARTER } from "./dialogue-starters";
import { dialogueImageSourceUrl, latestDialogueImage, type DialogueImageSource } from "./dialogue-image-source";
import { DialogueImageAttachment } from "./dialogue-image-attachment";
import {
  DEFAULT_GENERATION_SETTINGS, FORMAT_OPTIONS, TONE_OPTIONS, LENGTH_OPTIONS,
  TOPIC_COUNT_OPTIONS, IMAGE_ASPECT_OPTIONS, IMAGE_FORMAT_OPTIONS, IMAGE_KIND_OPTIONS, CAROUSEL_COUNT_OPTIONS, settingsForTool,
  type GenerationSettings,
} from "./dialogue-generation-settings";
import type { DialogueWorkspaceProps } from "./dialogue-workspace-types";
// Shared workspace modules still need their dialogue palette and layout.
import "./dialogue.css";
import "./dialogue-chatkit.css";
import "./dialogue-module-theme.css";
import "./dialogue-assistant.css";

type MutationResult = {
  thread: DialogueThread;
  generation?: {
    id: string;
    title: string;
    body: string;
    imageUrl: string;
    brandId: string | null;
  };
  selectedId?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error || "Не удалось выполнить действие.");
  return payload;
}

function cardFrom(thread: DialogueThread, cardId: string) {
  return thread.data.cards.find((card) => card.id === cardId) || null;
}

function actionPayload(action: { payload?: Record<string, unknown> }) {
  return {
    threadId:
      typeof action.payload?.threadId === "string"
        ? action.payload.threadId
        : "",
    cardId:
      typeof action.payload?.cardId === "string" ? action.payload.cardId : "",
  };
}

function NativeWorkspace(props: DialogueWorkspaceProps) {
  const { beforeProfile } = props;
  const [historyRevision, setHistoryRevision] = useState(0);
  const chatReady = true;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [useBrandContext, setUseBrandContext] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [toolChoice, setSelectedTool] = useState<string | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [generationSettings, setGenerationSettings] = useState(DEFAULT_GENERATION_SETTINGS);
  const generationSettingsRef = useRef(generationSettings);
  const [editCard, setEditCard] = useState<DialogueCard | null>(null);
  const [editThreadId, setEditThreadId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [previewImage, setPreviewImage] = useState<{ card: DialogueCard; threadId: string; pureImage: boolean; src?: string } | null>(null);
  const [previewResult, setPreviewResult] = useState<{ card: DialogueCard; threadId: string } | null>(null);
  const closeResult = useCallback(() => setPreviewResult(null), []);
  const closeImage = useCallback(() => setPreviewImage(null), []);
  const closePreviews = useCallback(() => { setPreviewResult(null); setPreviewImage(null); }, []);
  const [threadAction, setThreadAction] = useState<{ action: ThreadAction; thread: DialogueThread } | null>(null);
  const storageKey = `klio-chatkit:${props.userKey}:${props.brandId || "personal"}`;
  const [session] = useState(() => createDialogueSession({
    brandId: props.brandId || null, storageKey,
    onChange: () => setHistoryRevision((value) => value + 1),
  }));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  const [upload, setUpload] = useState<{ view: number; busy: boolean } | null>(null);
  const imageSource = snapshot.imageSource;
  const selectedTool = toolChoice ?? (imageSource ? "image" : null);
  const imageUploading = upload?.view === snapshot.view && upload.busy;
  const updateUsage = useEffectEvent(() => { if (snapshot.thread) props.onUsage(); });
  useEffect(() => { updateUsage(); }, [snapshot.thread?.id, snapshot.thread?.revision, snapshot.thread?.status]);
  const activeThreadId = snapshot.selectedId;
  const activeThreadRef = useRef(activeThreadId);
  useEffect(() => { activeThreadRef.current = activeThreadId; }, [activeThreadId]);
  useEffect(() => { session.start(); return () => session.stop(); }, [session]);
  useEffect(() => { if (props.visible) void session.refresh(); }, [props.visible, session]);
  const operationLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changeSetting = useCallback(<K extends keyof GenerationSettings,>(key: K, value: GenerationSettings[K]) => {
    const next = { ...generationSettingsRef.current, [key]: value };
    generationSettingsRef.current = next;
    setGenerationSettings(next);
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    return readJson<{ thread: DialogueThread }>(
      await fetch(`/api/dialogue?id=${encodeURIComponent(threadId)}`, {
        cache: "no-store",
      }),
    ).then((payload) => {
      if ((payload.thread.brandId || null) !== (props.brandId || null)) throw new Error("Диалог недоступен в этом пространстве.");
      return payload.thread;
    });
  }, [props.brandId]);

  const mutate = useCallback(
    async (
      thread: DialogueThread,
      action: string,
      extra: Record<string, unknown> = {},
    ) =>
      readJson<MutationResult>(
        await fetch("/api/dialogue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            id: thread.id,
            revision: thread.revision,
            ...extra,
          }),
        }),
      ).then((result) => {
        if ((result.thread.brandId || null) === (props.brandId || null)) session.accept(result.thread);
        setHistoryRevision((value) => value + 1);
        return result;
      }),
    [session, props.brandId],
  );

  const sendText = useCallback(async (text: string, requestedTool?: string) => {
    if (imageUploading) return false;
    setError(""); setNotice("");
    const before = session.getSnapshot();
    const latestImage = latestDialogueImage(before.thread?.data);
    const previousTool = selectedTool === "image" && generationSettingsRef.current.imageKind === "carousel" ? "carousel" : selectedTool;
    const tool = resolveDialogueTool(text, previousTool, requestedTool, Boolean(latestImage));
    if (!requestedTool) {
      if (tool === "chat" && selectedTool && selectedTool !== "chat") {
        setSelectedTool(null);
        session.setImageSource(null);
        setNotice("Перешли к общению. Настройки генерации сохранены.");
      } else if (tool !== "chat") {
        if (tool === "image" || tool === "carousel") changeSetting("imageKind", tool === "carousel" ? "carousel" : "single");
        setSelectedTool(tool === "carousel" ? "image" : tool);
      }
    }
    const source = tool === "image" ? imageSource || (!requestedTool && isImageEditRequest(text) ? latestImage : null) : null;
    const logoChange = tool === "image" ? requestedLogoChange(text) : null;
    if (logoChange !== null) changeSetting("useLogo", logoChange);
    const context = Boolean(props.brandId) && useBrandContext;
    const prompt = text.trim() || (tool === "topics" ? TOPICS_STARTER : "");
    const sent = await session.send(prompt, {
      mode: tool === "carousel" ? "carousel" : tool.startsWith("image-card:") || tool === "image" ? "image" : tool === "topics" ? "topics" : ["text", "topic-post", "topic-article"].includes(tool) ? "text" : "chat",
      ...(tool.startsWith("image-card:") ? { cardId: tool.slice("image-card:".length) } : {}),
      ...(source ? { imageSource: source } : {}),
      useBrandContext: context, settings: settingsForTool(tool, generationSettingsRef.current, props.hasLogo),
    }, context ? beforeProfile : undefined);
    if (sent) {
      if (!text.trim() && !session.getSnapshot().draft.trim()) session.setDraft("");
      setSettingsExpanded(false);
    }
    return sent;
  }, [beforeProfile, changeSetting, imageSource, imageUploading, props.brandId, props.hasLogo, selectedTool, session, useBrandContext]);
  // Actions on cards use the same local runtime and the same server contract.
  const dialogue = {
    setThreadId: session.open, fetchUpdates: session.refresh,
    sendUserMessage: async ({ text, toolChoice }: { text: string; toolChoice: { id: string } }) => {
      if (!await sendText(text, toolChoice.id)) throw new Error(session.getSnapshot().error || "Дождитесь завершения текущего ответа.");
    },
  };
  async function applyProfile(messageId: string) {
    if (operationLock.current || !snapshot.thread) return;
    operationLock.current = true; setActionBusy(true); setError("");
    try {
      if (!await beforeProfile()) throw new Error("Сначала сохраните текущие правки профиля бизнеса.");
      const result = await mutate(snapshot.thread, "profile", { messageId }) as MutationResult & { brand?: unknown };
      if (!mounted.current) return;
      if (result.brand) {
        // Applying a suggested profile can create a business and move the
        // thread out of personal space. Restore it in the new space as well.
        try {
          localStorage.setItem(`klio-chatkit:${props.userKey}:${result.thread.brandId || "personal"}`, result.thread.id);
          if ((result.thread.brandId || "") !== (props.brandId || "")) localStorage.removeItem(storageKey);
        } catch { /* Optional selection cache. */ }
        props.onProfile(result.brand);
      }
      setNotice("Профиль бренда обновлён");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось применить профиль."); }
    finally { operationLock.current = false; setActionBusy(false); }
  }
  const imported = useRef(0);
  useEffect(() => {
    const request = props.importMaterial;
    if (!request || imported.current === request.nonce || snapshot.loading || snapshot.sending || snapshot.thread?.status === "processing" || operationLock.current) return;
    imported.current = request.nonce;
    operationLock.current = true; setActionBusy(true);
    void session.ensureThread().then((thread) => mutate(thread, "import", { generationId: request.id }))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Не удалось импортировать материал."))
      .finally(() => { operationLock.current = false; setActionBusy(false); });
  }, [props.importMaterial, snapshot.loading, snapshot.sending, snapshot.thread?.status, session, mutate]);

  const handleWidgetAction = async (action: { type: string; payload?: Record<string, unknown> }) => {
      if (operationLock.current || session.getSnapshot().sending) return;
      const { threadId, cardId } = actionPayload(action);
      if (!threadId || !cardId) return;
      operationLock.current = true;
      setActionBusy(true);
      setError("");
      setNotice("");
      try {
        if (action.type === "klio.copy") {
          const currentCard = session.getSnapshot().thread?.data.cards.find((card) => card.id === cardId);
          const preview = [previewResult, previewImage].find((item) => item?.threadId === threadId && item.card.id === cardId) || (currentCard ? { card: currentCard } : null);
          if (!preview) throw new Error("Откройте материал для копирования.");
          if (!navigator.clipboard?.writeText) throw new Error("Браузер не разрешил копирование. Выделите текст в просмотре и скопируйте его.");
          // Copy the visible text before any fetch can consume Safari's user activation.
          await navigator.clipboard.writeText(`${preview.card.title}\n\n${preview.card.body}`.trim());
          setNotice("Текст скопирован");
          return;
        }
        const thread = await loadThread(threadId);
        if (!mounted.current) return;
        const card = cardFrom(thread, cardId);
        if (!card) throw new Error("Материал не найден в этом диалоге.");
        if (action.type === "klio.refine_image") {
          if (session.getSnapshot().selectedId !== threadId) return;
          const slideIndex = Number.isInteger(action.payload?.slideIndex) ? Number(action.payload?.slideIndex) : undefined;
          const source: DialogueImageSource = { cardId, ...(slideIndex === undefined ? {} : { slideIndex }), purpose: "edit" };
          if (!dialogueImageSourceUrl(source, thread.data)) throw new Error("Выберите изображение или конкретный слайд.");
          session.setImageSource(source);
          setSelectedTool("image"); changeSetting("imageKind", "single");
          setSettingsExpanded(false); closePreviews();
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea.klio-aui-input")?.focus());
          return;
        }
        if (action.type === "klio.view_result") {
          if (isStandaloneImage(thread, card)) setPreviewImage({ card, threadId, pureImage: true });
          else setPreviewResult({ card, threadId });
          return;
        }
        if (action.type === "klio.edit") {
          closePreviews();
          setEditCard(card);
          setEditThreadId(threadId);
          setEditTitle(card.title);
          setEditBody(card.body);
          return;
        }
        if (action.type === "klio.open_image") {
          const index = Number(action.payload?.slideIndex);
          const src = Number.isInteger(index) && index >= 0 ? card.slides?.[index]?.imageUrl : undefined;
          if (card.imageUrl) { closeResult(); setPreviewImage({ card, threadId, pureImage: isStandaloneImage(thread, card), src }); }
          return;
        }
        if (action.type === "klio.image") {
          const prompt = `Сделай иллюстрацию для материала: ${card.title}\n\n${card.body}`.slice(
            0,
            1600,
          );
          await dialogue.sendUserMessage({
            text: prompt,
            toolChoice: { id: `image-card:${card.id}` },
          });
          closePreviews();
          return;
        }
        if (action.type === "klio.topic_post" || action.type === "klio.topic_article") {
          const article = action.type === "klio.topic_article";
          await dialogue.sendUserMessage({
            text: `Создай отдельный ${article ? "развёрнутый материал для сайта" : "готовый пост для соцсетей"} на тему «${card.title}». ${card.body}\nИсходную карточку темы сохрани без изменений.`,
            toolChoice: { id: article ? "topic-article" : "topic-post" },
          });
          closePreviews();
          return;
        }
        if (action.type === "klio.topic_generator") {
          await props.onGenerateTopic?.({ title: card.title, body: card.body, useBrandContext });
          closePreviews();
          return;
        }
        if (action.type === "klio.save" || action.type === "klio.publish") {
          const result = await mutate(thread, "save", { cardId: card.id });
          if (!mounted.current) return;
          if (result.generation) props.onSaved(result.generation);
          props.onUsage();
          if (action.type === "klio.publish" && result.generation) {
            const pureImage = isStandaloneImage(thread, card);
            closePreviews();
            props.onSchedule({
              generationId: result.generation.id,
              title: pureImage ? "" : result.generation.title,
              body: pureImage ? "" : result.generation.body,
              imageUrl: result.generation.imageUrl,
            });
          } else {
            setNotice("Сохранено в материалах");
            const updated = cardFrom(result.thread, cardId);
            if (updated) {
              setPreviewResult((current) => current?.threadId === threadId && current.card.id === cardId ? { ...current, card: updated } : current);
              setPreviewImage((current) => current?.threadId === threadId && current.card.id === cardId ? { ...current, card: updated } : current);
            }
          }
          await dialogue.fetchUpdates();
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Не удалось выполнить действие.",
        );
      } finally {
        operationLock.current = false;
        setActionBusy(false);
      }
    };

  async function startNewThread() {
    if (operationLock.current || snapshot.sending) return;
    try {
      await dialogue.setThreadId(null);
      setSelectedTool(null);
      setSettingsExpanded(false);
      setError("");
      setNotice("");
      setRailOpen(false);
    } catch {
      setError("Не удалось открыть новый диалог. Попробуйте ещё раз.");
    }
  }

  async function openRecentThread(threadId?: string) {
    if (operationLock.current || snapshot.sending) return;
    try {
      if (threadId) await dialogue.setThreadId(threadId);
      else setHistoryOpen(true);
      setRailOpen(false);
      setError("");
      setNotice("");
    } catch {
      setError("Не удалось открыть диалог. Попробуйте ещё раз.");
    }
  }

  async function prepareThreadAction(action: ThreadAction, id: string) {
    if (operationLock.current) return;
    operationLock.current = true;
    setActionBusy(true); setError("");
    setRailOpen(false);
    try {
      // Capture the version shown in the confirmation. A later change in
      // another tab must not be silently overwritten or deleted.
      const thread = await loadThread(id);
      if (thread.status === "processing") throw new Error("Дождитесь ответа КЛИО, затем измените диалог.");
      setThreadAction({ action, thread });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось открыть диалог.");
    } finally { operationLock.current = false; setActionBusy(false); }
  }

  async function submitThreadAction(title: string) {
    if (!threadAction) return;
    const { action, thread } = threadAction;
    if (action === "rename") await mutate(thread, "rename", { title });
    else await readJson<{ deletedId: string }>(await fetch("/api/dialogue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: thread.id, revision: thread.revision }),
    }));
    setThreadAction(null);
    setHistoryRevision((value) => value + 1);
    setNotice(action === "rename" ? "Название диалога сохранено" : "Диалог удалён. Сохранённые материалы остались доступны.");
    try {
      if (activeThreadRef.current === thread.id) {
        if (action === "delete") {
          try { localStorage.removeItem(storageKey); } catch { /* Storage can be disabled. */ }
          await dialogue.setThreadId(null);
        } else await dialogue.fetchUpdates();
      }
    } catch {
      setError("Изменения сохранены. Обновите страницу, чтобы обновить ленту диалога.");
    }
  }

  async function saveEdit() {
    if (!editCard || !editThreadId || operationLock.current) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setError("Добавьте название и текст.");
      return;
    }
    operationLock.current = true;
    setActionBusy(true);
    setError("");
    try {
      const thread = await loadThread(editThreadId);
      const latest = cardFrom(thread, editCard.id);
      if (!latest || latest.title !== editCard.title || latest.body !== editCard.body || latest.imageUrl !== editCard.imageUrl) throw new Error("Материал изменён в другом окне. Скопируйте свои правки и откройте его заново.");
      await mutate(thread, "edit", {
        cardId: editCard.id,
        title: editTitle,
        body: editBody,
      });
      setEditCard(null);
      setEditThreadId("");
      setNotice("Изменения сохранены");
      await dialogue.fetchUpdates();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось сохранить изменения.",
      );
    } finally {
      operationLock.current = false;
      setActionBusy(false);
    }
  }

  return (
    <div
      className={`klio-chatkit-shell ${railOpen ? "rail-open" : ""}`}
      hidden={!props.visible}
    >
      <aside className="klio-chatkit-rail" aria-label="Разделы КЛИО">
        <div className="klio-chatkit-rail-head">
          <button className="klio-chatkit-close-rail"
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setRailOpen(false)}
          >
            ×
          </button>
        </div>
        <button
          type="button"
          className="klio-chatkit-new"
          disabled={snapshot.sending || actionBusy}
          onClick={() => void startNewThread()}
        >
          <span aria-hidden="true">＋</span> Новый диалог
        </button>
        <nav>
          <button type="button" onClick={() => props.onNavigate("brand")}>
            Мой бизнес
          </button>
          <button type="button" onClick={() => props.onNavigate("history")}>
            Материалы
          </button>
          <button
            type="button"
            onClick={() => props.onNavigate("publications")}
          >
            Публикации
          </button>
        </nav>
        <DialogueRecentThreads
          brandId={props.brandId}
          activeThreadId={activeThreadId}
          ready={chatReady}
          visible={props.visible}
          revision={historyRevision}
          onOpen={(id) => void openRecentThread(id)}
          onHistory={() => void openRecentThread()}
          onAction={(action, id) => void prepareThreadAction(action, id)}
        />
        <div className="klio-chatkit-brand">
          <span>Ваш бизнес</span>
          <div className="klio-chatkit-brand-select">
            <button
              type="button"
              aria-label="Выбрать бизнес"
              aria-expanded={brandMenuOpen}
              disabled={snapshot.sending || actionBusy}
              onClick={() => setBrandMenuOpen((open) => !open)}
            >
              <i>{(props.brandName || "Л").trim().charAt(0).toUpperCase()}</i>
              <span title={props.brandName || "Личное пространство"}>{props.brandName || "Личное пространство"}</span>
              <em aria-hidden="true">⌄</em>
            </button>
            {brandMenuOpen && <div className="klio-chatkit-brand-options">
              {props.brands.length > 0 && <div role="listbox" aria-label="Выберите бизнес">
                {props.brands.map((brand) => <button type="button" role="option" aria-selected={brand.id === props.brandId} key={brand.id} onClick={() => {
                  setBrandMenuOpen(false);
                  props.onBrandChange(brand.id);
                }}>{brand.name}</button>)}
              </div>}
              <button type="button" onClick={() => { setBrandMenuOpen(false); props.onNavigate("brand"); }}>{props.brands.length ? "Управление бизнесами" : "Добавить бизнес"} →</button>
            </div>}
          </div>
        </div>
        <a className="klio-chatkit-account" href="/account">
          Тариф и аккаунт
        </a>
      </aside>
      <button
        className="klio-chatkit-backdrop"
        type="button"
        aria-label="Закрыть меню"
        onClick={() => setRailOpen(false)}
      />
      <main className="klio-chatkit-main">
        <div className="klio-chatkit-toolbar">
        <button
          type="button"
          className="klio-chatkit-mobile-menu"
          aria-label="Открыть меню КЛИО"
          onClick={() => setRailOpen(true)}
        >
          ☰
        </button>
          <div className="klio-chatkit-toolbar-spacer" />
          <DialogueResultsMenu
            key={activeThreadId || "new"}
            threadId={activeThreadId}
            ready={chatReady}
            visible={props.visible}
            revision={historyRevision}
            onOpen={(card) => {
              const target = document.getElementById(`klio-chat-card-${card.id}`);
              if (target) {
                target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
                target.focus({ preventScroll: true });
              } else { void session.refresh(); setNotice("Обновляем результаты диалога. Выберите материал ещё раз."); }
            }}
          />
          <button className="klio-chatkit-history-button" type="button" aria-label="История диалогов" title="История диалогов" disabled={!chatReady} onClick={() => void openRecentThread()}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11a9 9 0 1 1 3 7M3 4v7h7M12 7v5l3 2" /></svg>
          </button>
        </div>
        {(notice || error || snapshot.error) && (
          <div
            className={`klio-chatkit-toast ${error || snapshot.error ? "is-error" : ""}`}
            role={error || snapshot.error ? "alert" : "status"}
          >
            {error || snapshot.error || notice}
            {snapshot.error && snapshot.selectedId && <button type="button" onClick={() => void session.refresh()}>Обновить диалог</button>}
          </div>
        )}
        <DialogueAssistantThread key={snapshot.view} session={session} snapshot={snapshot} tool={selectedTool === "image" && generationSettings.imageKind === "carousel" ? "carousel" : selectedTool} onTool={(tool) => { if (imageUploading) return; session.setImageSource(null); setSelectedTool(tool); if (tool === "image") changeSetting("imageKind", "single"); setSettingsExpanded(false); }} onSend={sendText} busy={actionBusy || imageUploading} onAction={(type, cardId, slideIndex) => { if (activeThreadId) void handleWidgetAction({ type, payload: { threadId: activeThreadId, cardId, slideIndex } }); }} onProfile={(messageId) => void applyProfile(messageId)} options={
<div className="klio-chatkit-composer-options">
          {selectedTool === "image" && generationSettings.imageKind !== "carousel" && <DialogueImageAttachment key={snapshot.view} source={imageSource} url={imageSource ? dialogueImageSourceUrl(imageSource, snapshot.thread?.data) : ""} busy={imageUploading} onBusy={(busy) => setUpload({ view: snapshot.view, busy })} onChange={session.setImageSource} />}
          <label className="klio-chatkit-brand-context">
            <input type="checkbox" checked={useBrandContext} disabled={!props.brandId} onChange={(event) => setUseBrandContext(event.target.checked)} />
            <span>Профиль бренда</span>
            {useBrandContext && props.brandName && <strong title={props.brandName}>{props.brandName}</strong>}
          </label>
        {selectedTool && ["topics", "text", "image"].includes(selectedTool) && (
          <DialogueSettingsPopover open={settingsExpanded && props.visible} onOpenChange={setSettingsExpanded} title={selectedTool === "image" ? "Параметры изображения" : selectedTool === "topics" ? "Параметры тем" : "Параметры текста"}>
              {(selectedTool === "topics" || selectedTool === "text") && <ModuleSelect variant="chatkit" label="Формат" value={generationSettings.format} options={FORMAT_OPTIONS} onChange={(value) => changeSetting("format", value)} />}
              {selectedTool === "topics" && <ModuleSelect variant="chatkit" label="Количество тем" value={generationSettings.topicCount} options={TOPIC_COUNT_OPTIONS} onChange={(value) => changeSetting("topicCount", value)} />}
              {selectedTool === "text" && <>
                <ModuleSelect variant="chatkit" label="Тон" value={generationSettings.tone} options={TONE_OPTIONS} onChange={(value) => changeSetting("tone", value)} />
                <ModuleSelect variant="chatkit" label="Объём" value={generationSettings.length} options={LENGTH_OPTIONS} onChange={(value) => changeSetting("length", value)} />
              </>}
              {selectedTool === "image" && <>
                <ModuleSelect variant="chatkit" label="Результат" value={generationSettings.imageKind} options={IMAGE_KIND_OPTIONS} onChange={(value) => changeSetting("imageKind", value)} />
                {generationSettings.imageKind === "carousel" && <>
                  <ModuleSelect variant="chatkit" label="Количество слайдов" value={generationSettings.carouselSlideCount} options={CAROUSEL_COUNT_OPTIONS} onChange={(value) => changeSetting("carouselSlideCount", value)} />
                  <small>Первый слайд — обложка, дальше текстовые слайды. Один слайд — один материал из лимита.</small>
                </>}
                <ModuleSelect variant="chatkit" label="Ориентация" value={generationSettings.imageAspectRatio} options={IMAGE_ASPECT_OPTIONS} onChange={(value) => changeSetting("imageAspectRatio", value)} />
                <ModuleSelect variant="chatkit" label="Формат файла" value={generationSettings.imageOutputFormat} options={IMAGE_FORMAT_OPTIONS} onChange={(value) => changeSetting("imageOutputFormat", value)} />
                {props.hasLogo ? <label className="klio-chatkit-settings-logo"><input type="checkbox" checked={generationSettings.useLogo} onChange={(event) => changeSetting("useLogo", event.target.checked)} />Логотип на изображении</label> : <button type="button" className="klio-chatkit-settings-logo" onClick={() => props.onNavigate("brand")}>＋ Добавить логотип</button>}
              </>}
          </DialogueSettingsPopover>
        )}
        <small className="klio-aui-quota">
          {selectedTool === "topics" ? `Подбор тем: осталось ${props.researchRemaining ?? "—"} запусков`
            : selectedTool === "image" || selectedTool === "text" ? `Материалы: осталось ${props.generationsRemaining ?? "—"}${selectedTool === "image" && generationSettings.imageKind === "carousel" ? ` · на карусель нужно ${generationSettings.carouselSlideCount}` : ""}`
            : `Общение: осталось ${props.dialogueRemaining ?? "—"} ответов`}
        </small>
        </div>
        } />
        <span className="klio-chatkit-thread-state" aria-live="polite">
          {actionBusy
            ? "Выполняем…"
            : activeThreadId
              ? ""
              : "Новый диалог"}
        </span>
      </main>
      {editCard && (
        <DialogueModal title="Редактировать материал" busy={actionBusy} onClose={() => {
          if ((editTitle !== editCard.title || editBody !== editCard.body) && !window.confirm("Закрыть без сохранения правок?")) return;
          setEditCard(null); setEditThreadId("");
        }}>
          <div className="klio-aui-editor-fields">
            <label>
              <span>Заголовок</span>
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </label>
            <label>
              <span>Текст</span>
              <textarea
                rows={14}
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
              />
            </label>
            <footer>
              {error && <p role="alert">{error}</p>}
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  if ((editTitle !== editCard.title || editBody !== editCard.body) && !window.confirm("Закрыть без сохранения правок?")) return;
                  setEditCard(null);
                  setEditThreadId("");
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void saveEdit()}
              >
                Сохранить
              </button>
            </footer>
          </div>
        </DialogueModal>
      )}
      {previewImage && props.visible && <ImageLightbox src={previewImage.src || previewImage.card.imageUrl} alt="Изображение из диалога" onClose={closeImage} actions={<DialogueResultActions card={previewImage.card} pureImage={previewImage.pureImage} busy={actionBusy} error={error} notice={notice} onAction={(type) => void handleWidgetAction({ type, payload: { threadId: previewImage.threadId, cardId: previewImage.card.id } })} />} />}
      {previewResult && props.visible && <DialogueResultPreview card={previewResult.card} onClose={closeResult} onImage={() => void handleWidgetAction({ type: "klio.open_image", payload: { threadId: previewResult.threadId, cardId: previewResult.card.id } })}
        actions={<DialogueResultActions card={previewResult.card} pureImage={false} busy={actionBusy} error={error} notice={notice} onAction={(type) => void handleWidgetAction({ type, payload: { threadId: previewResult.threadId, cardId: previewResult.card.id } })} />} />}
      {threadAction && props.visible && <DialogueThreadDialog key={`${threadAction.action}:${threadAction.thread.id}`} thread={threadAction.thread} action={threadAction.action} onClose={() => setThreadAction(null)} onSubmit={submitThreadAction} />}
      {historyOpen && props.visible && <DialogueHistory brandId={props.brandId} onClose={() => setHistoryOpen(false)} onOpen={(id) => { setHistoryOpen(false); void openRecentThread(id); }} />}
    </div>
  );
}

export function DialogueWorkspace(props: DialogueWorkspaceProps) {
  return <NativeWorkspace key={`${props.userKey}:${props.brandId || "personal"}`} {...props} />;
}
