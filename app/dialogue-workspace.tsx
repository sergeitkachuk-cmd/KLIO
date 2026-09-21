"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { DialogueCard, DialogueThread } from "./dialogue-model";
import { ModuleSelect } from "./module-select";
import {
  DEFAULT_GENERATION_SETTINGS, FORMAT_OPTIONS, TONE_OPTIONS, LENGTH_OPTIONS,
  TOPIC_COUNT_OPTIONS, IMAGE_ASPECT_OPTIONS, IMAGE_FORMAT_OPTIONS, settingsForTool,
  type GenerationSettings,
} from "./dialogue-generation-settings";
import {
  LegacyDialogueWorkspace,
  type DialogueWorkspaceProps,
} from "./dialogue-workspace-legacy";
import "./dialogue-chatkit.css";

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

const CHATKIT_SCRIPT =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";

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

function ChatKitWorkspace(
  props: DialogueWorkspaceProps & {
    domainKey: string;
    onUnavailable: () => void;
  },
) {
  const { onUnavailable } = props;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatReady, setChatReady] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [useBrandContext, setUseBrandContext] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [generationSettings, setGenerationSettings] = useState(DEFAULT_GENERATION_SETTINGS);
  const generationSettingsRef = useRef(generationSettings);
  const [editCard, setEditCard] = useState<DialogueCard | null>(null);
  const [editThreadId, setEditThreadId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const storageKey = `klio-chatkit:${props.userKey}:${props.brandId || "personal"}`;
  // Let the element restore its own thread after loading. Its imperative
  // methods do not exist while the external script is still downloading.
  const [initialThread] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey) || null;
    } catch {
      // SSR and browsers with unavailable storage start with a blank thread.
      return null;
    }
  });
  const activeThreadRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  function changeSetting<K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) {
    const next = { ...generationSettingsRef.current, [key]: value };
    generationSettingsRef.current = next;
    setGenerationSettings(next);
  }

  const chatFetch = useCallback<typeof fetch>(async (input, init) => {
    // ChatKit owns the composer. Add KLIO settings only to message submissions,
    // using the tool in the submitted payload (selection clears after send).
    const target = typeof input === "string" ? new URL(input, window.location.href) : input;
    const outgoing = new Request(target, { ...init, credentials: "same-origin" });
    if (outgoing.method !== "POST") return fetch(outgoing);
    const body = await outgoing.clone().json().catch(() => null);
    if (body?.type !== "threads.create" && body?.type !== "threads.add_user_message") return fetch(outgoing);
    const tool = body.params?.input?.inference_options?.tool_choice?.id || "";
    body.params = {
      ...body.params,
      klio_settings: settingsForTool(tool, generationSettingsRef.current, Boolean(props.hasLogo)),
    };
    const headers = new Headers(outgoing.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    return fetch(new Request(outgoing, { headers, body: JSON.stringify(body) }));
  }, [props.hasLogo]);

  const loadThread = useCallback(async (threadId: string) => {
    return readJson<{ thread: DialogueThread }>(
      await fetch(`/api/dialogue?id=${encodeURIComponent(threadId)}`, {
        cache: "no-store",
      }),
    ).then((payload) => payload.thread);
  }, []);

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
      ),
    [],
  );

  const onWidgetActionRef = useRef<
    ((
      action: { type: string; payload?: Record<string, unknown> },
    ) => Promise<void>) | null
  >(null);

  const apiUrl = useMemo(() => {
    const query = new URLSearchParams();
    if (props.brandId) query.set("brandId", props.brandId);
    if (useBrandContext) query.set("brandContext", "1");
    return `/api/chatkit?${query.toString()}`;
  }, [props.brandId, useBrandContext]);

  const chatkit = useChatKit({
    initialThread,
    api: {
      url: apiUrl,
      domainKey: props.domainKey,
      fetch: chatFetch,
    },
    locale: "ru-RU",
    theme: {
      colorScheme: props.theme,
      radius: "round",
      density: "normal",
      typography: {
        baseSize: 16,
        fontFamily: "var(--font-sans), Arial, sans-serif",
      },
      color: {
        accent: {
          primary: props.theme === "dark" ? "#c7dbed" : "#254263",
          level: 1,
        },
        grayscale: { hue: 214, tint: props.theme === "dark" ? 9 : 2, shade: 0 },
        surface: props.theme === "dark"
          ? { background: "#081b30", foreground: "#102c49" }
          : { background: "#ffffff", foreground: "#f1f5f9" },
      },
    },
    header: {
      enabled: true,
      title: { enabled: true },
    },
    history: {
      enabled: true,
      showDelete: false,
      showRename: true,
    },
    startScreen: {
      greeting: "Чем я могу помочь?",
      prompts: [
        {
          label: "Предложить темы",
          prompt: "Предложи пять сильных тем для контента",
          icon: "lightbulb",
        },
        {
          label: "Написать пост",
          prompt: "Помоги написать пост. Сначала уточни тему, если её недостаточно.",
          icon: "square-text",
        },
        {
          label: "Разобрать идею",
          prompt: "Помоги развить мою идею и предложи следующие шаги",
          icon: "sparkle",
        },
      ],
    },
    composer: {
      placeholder: "Спросите КЛИО или поставьте задачу",
      attachments: { enabled: false },
      tools: [
        {
          id: "topics",
          label: "Предложить темы",
          shortLabel: "Темы",
          icon: "lightbulb",
          placeholderOverride: "Какие темы подобрать?",
        },
        {
          id: "text",
          label: "Написать текст",
          shortLabel: "Текст",
          icon: "square-text",
          placeholderOverride: "О чём и для какой площадки написать?",
        },
        {
          id: "image",
          label: "Создать изображение",
          shortLabel: "Изображение",
          icon: "square-image",
          placeholderOverride: "Опишите изображение",
        },
      ],
    },
    threadItemActions: { feedback: false, retry: false },
    thread: { autoScroll: true },
    disclaimer: {
      text: "КЛИО может ошибаться. Проверяйте важные факты перед публикацией.",
    },
    widgets: {
      onAction: async (action) => {
        await onWidgetActionRef.current?.(action);
      },
    },
    onThreadChange: ({ threadId }) => {
      activeThreadRef.current = threadId;
      setActiveThreadId(threadId);
      try {
        if (threadId) localStorage.setItem(storageKey, threadId);
        else localStorage.removeItem(storageKey);
      } catch {
        // Conversation selection still works if private mode blocks storage.
      }
    },
    onResponseStart: () => {
      setError("");
      setNotice("");
    },
    onToolChange: ({ toolId }) => {
      setSelectedTool(toolId);
      setSettingsExpanded(true);
    },
    onResponseEnd: () => {
      props.onUsage();
    },
    onReady: () => {
      readyRef.current = true;
      setChatReady(true);
    },
    onError: ({ error: chatError }) => {
      console.error("ChatKit UI error", chatError);
      if (!readyRef.current) {
        onUnavailable();
        return;
      }
      setError("Не удалось открыть ответ. Диалог сохранён — попробуйте ещё раз.");
    },
  });

  const handleWidgetAction = useCallback(
    async (action: { type: string; payload?: Record<string, unknown> }) => {
      if (actionBusy) return;
      const { threadId, cardId } = actionPayload(action);
      if (!threadId || !cardId) return;
      setActionBusy(true);
      setError("");
      setNotice("");
      try {
        const thread = await loadThread(threadId);
        const card = cardFrom(thread, cardId);
        if (!card) throw new Error("Материал не найден в этом диалоге.");
        if (action.type === "klio.edit") {
          setEditCard(card);
          setEditThreadId(threadId);
          setEditTitle(card.title);
          setEditBody(card.body);
          return;
        }
        if (action.type === "klio.open_image") {
          if (card.imageUrl)
            window.open(card.imageUrl, "_blank", "noopener,noreferrer");
          return;
        }
        if (action.type === "klio.image") {
          const prompt = `Сделай иллюстрацию для материала: ${card.title}\n\n${card.body}`.slice(
            0,
            1600,
          );
          await chatkit.sendUserMessage({
            text: prompt,
            toolChoice: { id: `image-card:${card.id}` },
          });
          return;
        }
        if (action.type === "klio.topic_post") {
          await chatkit.sendUserMessage({
            text: `Напиши готовый пост для соцсетей на тему «${card.title}». ${card.body}`,
            toolChoice: { id: "text" },
          });
          return;
        }
        if (action.type === "klio.save" || action.type === "klio.publish") {
          const result = await mutate(thread, "save", { cardId: card.id });
          if (result.generation) props.onSaved(result.generation);
          props.onUsage();
          if (action.type === "klio.publish" && result.generation) {
            const pureImage =
              Boolean(result.generation.imageUrl) &&
              !result.generation.body.trim();
            props.onSchedule({
              generationId: result.generation.id,
              title: pureImage ? "" : result.generation.title,
              body: pureImage ? "" : result.generation.body,
              imageUrl: result.generation.imageUrl,
            });
          } else {
            setNotice("Сохранено в материалах");
          }
          await chatkit.fetchUpdates();
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Не удалось выполнить действие.",
        );
      } finally {
        setActionBusy(false);
      }
    }, [actionBusy, chatkit, loadThread, mutate, props]);

  useEffect(() => {
    onWidgetActionRef.current = handleWidgetAction;
  }, [handleWidgetAction]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!readyRef.current) onUnavailable();
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [onUnavailable]);

  async function startNewThread() {
    if (!readyRef.current) return;
    try {
      await chatkit.setThreadId(null);
      activeThreadRef.current = null;
      setActiveThreadId(null);
      setError("");
      setNotice("");
      setRailOpen(false);
    } catch {
      setError("Не удалось открыть новый диалог. Попробуйте ещё раз.");
    }
  }

  async function saveEdit() {
    if (!editCard || !editThreadId) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setError("Добавьте название и текст.");
      return;
    }
    setActionBusy(true);
    setError("");
    try {
      const thread = await loadThread(editThreadId);
      await mutate(thread, "edit", {
        cardId: editCard.id,
        title: editTitle,
        body: editBody,
      });
      setEditCard(null);
      setEditThreadId("");
      setNotice("Изменения сохранены");
      await chatkit.fetchUpdates();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось сохранить изменения.",
      );
    } finally {
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
          disabled={!chatReady}
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
        <div className="klio-chatkit-rail-spacer" />
        <div className="klio-chatkit-brand">
          <span>Ваш бизнес</span>
          <div className="klio-chatkit-brand-select">
            <button
              type="button"
              aria-label="Выбрать бизнес"
              aria-expanded={brandMenuOpen}
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
        <label className="klio-chatkit-brand-context">
          <input
            type="checkbox"
            checked={useBrandContext}
            disabled={!props.brandId}
            onChange={(event) => setUseBrandContext(event.target.checked)}
          />
          <span>Учитывать профиль бренда</span>
        </label>
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
        <button
          type="button"
          className="klio-chatkit-mobile-menu"
          aria-label="Открыть меню КЛИО"
          onClick={() => setRailOpen(true)}
        >
          ☰
        </button>
        {(notice || error) && (
          <div
            className={`klio-chatkit-toast ${error ? "is-error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error || notice}
          </div>
        )}
        <ChatKit
          control={chatkit.control}
          className={`klio-chatkit-frame ${chatReady ? "is-ready" : ""}`}
          aria-hidden={!chatReady}
        />
        {chatReady && selectedTool && ["topics", "text", "image"].includes(selectedTool) && (
          <section className="klio-chatkit-settings" aria-label="Параметры генерации">
            <button type="button" className="klio-chatkit-settings-toggle" aria-expanded={settingsExpanded} aria-controls="chatkit-generation-settings" onClick={() => setSettingsExpanded((value) => !value)}>
              <span>{selectedTool === "image" ? "Параметры изображения" : selectedTool === "topics" ? "Параметры тем" : "Параметры текста"}</span>
              <span>{settingsExpanded ? "Свернуть" : "Настроить"} <span aria-hidden="true">{settingsExpanded ? "⌄" : "⌃"}</span></span>
            </button>
            <div id="chatkit-generation-settings" className="klio-chatkit-settings-grid" hidden={!settingsExpanded}>
              {(selectedTool === "topics" || selectedTool === "text") && <ModuleSelect variant="chatkit" label="Формат" value={generationSettings.format} options={FORMAT_OPTIONS} onChange={(value) => changeSetting("format", value)} />}
              {selectedTool === "topics" && <ModuleSelect variant="chatkit" label="Количество тем" value={generationSettings.topicCount} options={TOPIC_COUNT_OPTIONS} onChange={(value) => changeSetting("topicCount", value)} />}
              {selectedTool === "text" && <>
                <ModuleSelect variant="chatkit" label="Тон" value={generationSettings.tone} options={TONE_OPTIONS} onChange={(value) => changeSetting("tone", value)} />
                <ModuleSelect variant="chatkit" label="Объём" value={generationSettings.length} options={LENGTH_OPTIONS} onChange={(value) => changeSetting("length", value)} />
              </>}
              {selectedTool === "image" && <>
                <ModuleSelect variant="chatkit" label="Ориентация" value={generationSettings.imageAspectRatio} options={IMAGE_ASPECT_OPTIONS} onChange={(value) => changeSetting("imageAspectRatio", value)} />
                <ModuleSelect variant="chatkit" label="Формат файла" value={generationSettings.imageOutputFormat} options={IMAGE_FORMAT_OPTIONS} onChange={(value) => changeSetting("imageOutputFormat", value)} />
                {props.hasLogo ? <label className="klio-chatkit-settings-logo"><input type="checkbox" checked={generationSettings.useLogo} onChange={(event) => changeSetting("useLogo", event.target.checked)} />Использовать логотип бренда</label> : <button type="button" className="klio-chatkit-settings-logo" onClick={() => props.onNavigate("brand")}>Загрузить логотип бренда →</button>}
              </>}
            </div>
          </section>
        )}
        {!chatReady && (
          <div className="klio-chatkit-loading" role="status" aria-live="polite">
            <span aria-hidden="true" />
            <p>Открываем диалог…</p>
          </div>
        )}
        <span className="klio-chatkit-thread-state" aria-live="polite">
          {actionBusy
            ? "Выполняем…"
            : activeThreadId
              ? ""
              : "Новый диалог"}
        </span>
      </main>
      {editCard && (
        <div className="klio-chatkit-editor-layer" role="presentation">
          <section
            className="klio-chatkit-editor"
            role="dialog"
            aria-modal="true"
            aria-label="Редактировать материал"
          >
            <header>
              <h2>Редактировать материал</h2>
              <button
                type="button"
                onClick={() => {
                  setEditCard(null);
                  setEditThreadId("");
                }}
              >
                ×
              </button>
            </header>
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
              <button
                type="button"
                onClick={() => {
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
          </section>
        </div>
      )}
    </div>
  );
}

export function DialogueWorkspace(props: DialogueWorkspaceProps) {
  const configuredDomainKey =
    process.env.NEXT_PUBLIC_CHATKIT_DOMAIN_KEY?.trim() || "";
  const [scriptFailed, setScriptFailed] = useState(false);
  const useLegacyFallback = useCallback(() => setScriptFailed(true), []);
  const domainKey =
    configuredDomainKey ||
    (process.env.NODE_ENV === "development" ? "domain_pk_localhost_dev" : "");
  if (!domainKey || scriptFailed)
    return <LegacyDialogueWorkspace {...props} />;

  return (
    <>
      <Script
        src={CHATKIT_SCRIPT}
        strategy="afterInteractive"
        onError={useLegacyFallback}
      />
      <ChatKitWorkspace
        key={`${props.userKey}:${props.brandId || "personal"}`}
        {...props}
        domainKey={domainKey}
        onUnavailable={useLegacyFallback}
      />
    </>
  );
}
