"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  sameCard,
  type DialogueCard,
  type DialogueThread,
} from "./dialogue-model";
import { ModuleSelect } from "./module-select";
import { TONE_PLANS, type ContentFormat, type ContentTone } from "./content-plans";
import "./dialogue.css";

const FORMAT_OPTIONS: { value: ContentFormat | ""; label: string }[] = [
  { value: "", label: "Авто" },
  { value: "social", label: "Пост для соцсетей" },
  { value: "seo", label: "SEO-статья" },
  { value: "ads", label: "Рекламный текст" },
  { value: "landing", label: "Текст для сайта" },
];
const TONE_OPTIONS: { value: ContentTone | ""; label: string }[] = [
  { value: "", label: "Голос бренда" },
  ...(Object.keys(TONE_PLANS) as ContentTone[]).map((tone) => ({ value: tone, label: tone })),
];
const LENGTH_OPTIONS = [
  { value: "", label: "Авто" },
  { value: "short", label: "Короткий" },
  { value: "medium", label: "Средний" },
  { value: "long", label: "Длинный" },
];
const TOPIC_COUNT_OPTIONS = [3, 5, 8, 10].map((n) => ({ value: String(n), label: String(n) }));
const IMAGE_ASPECT_OPTIONS = [
  { value: "4:3", label: "4:3 (стандартный)" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];
const IMAGE_FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WEBP" },
];
const INTENT_OPTIONS: { value: "topics" | "text" | "image"; label: string; hint: string }[] = [
  { value: "topics", label: "Темы для контент-плана", hint: "Список идей под формат и бренд" },
  { value: "text", label: "Написать текст", hint: "Пост, статья или другой формат" },
  { value: "image", label: "Изображение", hint: "К выбранной теме или с нуля по описанию" },
];

type Summary = Pick<DialogueThread, "id" | "title" | "updatedAt" | "status">;
type SharedGeneration = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  brandId: string | null;
};
type Props = {
  brandId: string;
  brandName: string;
  userKey: string;
  visible: boolean;
  brands: Array<{ id: string; name: string }>;
  remaining: number;
  onNavigate: (section: "history" | "publications" | "brand") => void;
  onBrandChange: (id: string) => void;
  onSaved: (generation: SharedGeneration) => void;
  onProfessional: (generation: SharedGeneration) => void;
  onProfile: (brand: unknown) => void;
  beforeProfile: () => Promise<boolean>;
  onUsage: () => void;
  onSchedule: (source: {
    title: string;
    body: string;
    generationId: string;
    imageUrl: string;
  }) => void;
  importMaterial: { id: string; nonce: number } | null;
};
type ApiResult = {
  thread: DialogueThread;
  generation?: SharedGeneration;
  brand?: unknown;
  selectedId?: string;
  imageAvailable?: boolean;
};

async function requestApi(body: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch("/api/dialogue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error || "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
  return payload;
}

export function DialogueWorkspace(props: Props) {
  const [threads, setThreads] = useState<Summary[]>([]);
  const [thread, setThread] = useState<DialogueThread | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState(false);
  const [profileMode, setProfileMode] = useState(false);
  const [useBrandContext, setUseBrandContext] = useState(true);
  const [selected, setSelected] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageAvailable, setImageAvailable] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  // Explicit, optional generation settings (site owner: "они должны быть
  // необязательны... но очень явными, как в chatgpt") - "" means "let КЛИО
  // decide naturally", matching a person who just wants to chat without
  // configuring anything. Persist across sends within this session the
  // same way useBrandContext already does, not per-message.
  const [genFormat, setGenFormat] = useState<ContentFormat | "">("");
  const [genTone, setGenTone] = useState<ContentTone | "">("");
  const [genLength, setGenLength] = useState("");
  const [topicCount, setTopicCount] = useState("5");
  const [imageAspectRatio, setImageAspectRatio] = useState("4:3");
  const [imageOutputFormat, setImageOutputFormat] = useState("png");
  // Replaces one always-visible settings panel (site owner: "мы реально
  // путаем человека предлагая ему кучу настроек разом") with a ChatGPT-
  // style "+" picker: chat stays plain by default, and choosing a task
  // surfaces only the settings that apply to it - формат+количество for a
  // topic list, тон+объём for text, соотношение+формат for an image. Resets
  // to "chat" after every send, same as ChatGPT's own tool picker - each
  // message chooses its own task fresh instead of a sticky mode.
  const [composeIntent, setComposeIntent] = useState<"chat" | "topics" | "text" | "image">("chat");
  const [intentMenuOpen, setIntentMenuOpen] = useState(false);
  const current = useRef<DialogueThread | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);
  const pendingSend = useRef<{ id: string; text: string; mode: string } | null>(
    null,
  );
  const end = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const storageKey = `klio-dialogue:${props.userKey}:${props.brandId || "personal"}`;
  const card = thread?.data.cards.find((c) => c.id === selected);
  const dirty = Boolean(
    editorOpen && card && (editTitle !== card.title || editBody !== card.body),
  );
  const processing = thread?.status === "processing";
  const threadId = thread?.id;

  const accept = useCallback(
    (value: DialogueThread) => {
      if (!mounted.current) return;
      current.current = value;
      setThread(value);
      setThreads((list) => [
        {
          id: value.id,
          title: value.title,
          status: value.status,
          updatedAt: value.updatedAt,
        },
        ...list.filter((item) => item.id !== value.id),
      ]);
      try {
        localStorage.setItem(storageKey, value.id);
      } catch {
        /* unavailable storage must not block chat */
      }
    },
    [storageKey],
  );

  const listThreads = useCallback(
    async (before?: string) => {
      const response = await fetch(
        `/api/dialogue?brandId=${encodeURIComponent(props.brandId)}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Не удалось загрузить диалоги.");
      if (!mounted.current) return;
      setThreads((list) =>
        before
          ? [
              ...list,
              ...payload.threads.filter(
                (item: Summary) => !list.some((old) => old.id === item.id),
              ),
            ]
          : payload.threads,
      );
      setNext(payload.next);
      setImageAvailable(payload.imageAvailable === true);
    },
    [props.brandId],
  );

  const loadThread = useCallback(
    async (id: string) => {
      const response = await fetch(
        `/api/dialogue?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Не удалось открыть диалог.");
      if (payload.thread.brandId !== (props.brandId || null))
        throw new Error("Этот диалог относится к другому бизнесу.");
      if (!mounted.current) return;
      const different = current.current?.id !== id;
      accept(payload.thread);
      setImageAvailable(payload.imageAvailable === true);
      if (different) {
        setSelected("");
        setEditorOpen(false);
      }
      try {
        setDraft(localStorage.getItem(`${storageKey}:${id}:draft`) || "");
      } catch {
        setDraft("");
      }
    },
    [accept, props.brandId, storageKey],
  );

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        await listThreads();
        const remembered = localStorage.getItem(storageKey);
        if (remembered) await loadThread(remembered);
        else setDraft(localStorage.getItem(`${storageKey}:new:draft`) || "");
      } catch (e) {
        if (mounted.current)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить диалоги.",
          );
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [listThreads, loadThread, storageKey]);

  useEffect(() => {
    if (loading) return;
    try {
      localStorage.setItem(`${storageKey}:${thread?.id || "new"}:draft`, draft);
    } catch {
      /* keep input in memory */
    }
  }, [draft, loading, storageKey, thread?.id]);

  useEffect(() => {
    if (!processing || !threadId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = threadId;
    async function poll() {
      try {
        const response = await fetch(
          `/api/dialogue?id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Не удалось проверить ответ.");
        if (cancelled || current.current?.id !== id) return;
        accept(payload.thread);
        if (payload.thread.status !== "processing") {
          setError("");
          const last = payload.thread.data.messages.at(-1);
          if (last?.cardIds?.length === 1) setSelected(last.cardIds[0]);
          propsRef.current.onUsage();
          return;
        }
      } catch {
        if (!cancelled)
          setError(
            "Связь прервалась. Проверяем результат — повторная генерация не запускается.",
          );
      }
      if (!cancelled) timer = setTimeout(poll, 2500);
    }
    timer = setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accept, processing, threadId]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.data.messages.length, processing]);
  useEffect(() => {
    if (editorOpen && !editor.current?.open) editor.current?.showModal();
    if (!editorOpen && editor.current?.open) editor.current.close();
  }, [editorOpen]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function ensureThread() {
    if (current.current) return current.current;
    let id: string;
    try {
      id =
        localStorage.getItem(`${storageKey}:creating`) || crypto.randomUUID();
      localStorage.setItem(`${storageKey}:creating`, id);
    } catch {
      id = crypto.randomUUID();
    }
    const result = await requestApi({
      action: "create",
      id,
      brandId: props.brandId,
    });
    accept(result.thread);
    try {
      localStorage.removeItem(`${storageKey}:creating`);
    } catch {
      /* optional cache */
    }
    return result.thread;
  }

  async function mutate(action: string, values: Record<string, unknown> = {}) {
    if (action === "profile" && !(await propsRef.current.beforeProfile()))
      throw new Error("Сначала сохраните текущие правки профиля бизнеса.");
    const t = await ensureThread();
    const result = await requestApi({
      action,
      id: t.id,
      revision: t.revision,
      cardId: selected,
      ...values,
    });
    accept(result.thread);
    if (result.generation) propsRef.current.onSaved(result.generation);
    if (result.brand) {
      try {
        localStorage.setItem(
          `klio-dialogue:${props.userKey}:${result.thread.brandId || "personal"}`,
          result.thread.id,
        );
      } catch {
        /* optional cache */
      }
      propsRef.current.onProfile(result.brand);
    }
    if (result.selectedId) setSelected(result.selectedId);
    return result;
  }

  async function perform(work: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Не удалось выполнить действие.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function commitTitle() {
    setTitleEditing(false);
    const value = titleDraft.trim();
    if (!value || !thread || value === thread.title) return;
    void perform(() => mutate("rename", { title: value }));
  }

  // Cards (topics, posts, notes) generated earlier in a long dialogue
  // scroll out of view once you keep working on one of them (site owner:
  // "темы... уже далеко улетели и неудобно их найти") - this jumps back
  // to any card by id instead of manually scrolling the whole thread.
  function jumpToCard(id: string) {
    setCardMenuOpen(false);
    setSelected(id);
    document
      .getElementById(`klio-chat-card-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const importRef = useRef(0);
  const importEvent = useEffectEvent(async (id: string) => {
    await perform(async () => {
      const result = await mutate("import", { generationId: id });
      if (result.selectedId) setSelected(result.selectedId);
    });
  });
  useEffect(() => {
    const request = props.importMaterial;
    if (!request || importRef.current === request.nonce || loading) return;
    importRef.current = request.nonce;
    void importEvent(request.id);
  }, [props.importMaterial, loading]);

  const resumeEvent = useEffectEvent(() => {
    const t = current.current;
    if (t && t.status !== "processing" && !busy && !editorOpen)
      void perform(() => loadThread(t.id));
  });
  useEffect(() => {
    if (props.visible && !loading) resumeEvent();
  }, [props.visible, loading]);

  async function send(
    mode = profileMode ? "profile" : "chat",
    text = draft,
    cardId = selected,
  ) {
    if (!text.trim() || processing) return;
    await perform(async () => {
      const t = await ensureThread();
      const retry = pendingSend.current;
      const requestId =
        retry?.text === text && retry.mode === mode
          ? retry.id
          : crypto.randomUUID();
      pendingSend.current = { id: requestId, text, mode };
      const result = await requestApi({
        action: "send",
        id: t.id,
        revision: t.revision,
        requestId,
        text,
        mode,
        cardId,
        search,
        useBrandContext: profileMode || (Boolean(props.brandId) && useBrandContext),
        settings: {
          format: genFormat || undefined,
          tone: genTone || undefined,
          length: genLength || undefined,
          topicCount: Number(topicCount),
          imageAspectRatio,
          imageOutputFormat,
        },
      });
      accept(result.thread);
      pendingSend.current = null;
      setDraft("");
      setProfileMode(false);
      try {
        localStorage.removeItem(`${storageKey}:new:draft`);
      } catch {
        /* optional cache */
      }
    });
  }

  // Shared by the card's own "Создать картинку" button and the "+"
  // picker's image intent, so the two prompts can't drift apart. Grounded
  // in the source card's title+body when there is one, with extra folded
  // in as optional wishes; without a card, extra (the typed description)
  // is the whole prompt.
  function buildImagePrompt(source: DialogueCard | undefined, extra: string) {
    const wishes = extra.trim();
    if (!source) return wishes;
    const base = `Сделай иллюстрацию для статьи: ${source.title}\n\n${source.body}`.slice(0, 1600);
    return wishes ? `${base}\n\nПожелания к изображению: ${wishes}` : base;
  }

  // Shared by the form's submit and the textarea's Enter-to-send, so the
  // two can't drift apart. An image grounded in a selected card still
  // works with an empty draft (the draft is only optional extra wishes
  // there) - the server always needs non-empty text, so that only works
  // here because buildImagePrompt constructs real text from the card.
  // Without a card (site owner: "у нас свободный диалог, свободная
  // генерация" - no topic needs to exist first, same as professional
  // mode's own image generator), the draft itself is the description and
  // can't be empty.
  function submitCompose() {
    if (composeIntent === "image") {
      if (!card && !draft.trim()) return;
      setComposeIntent("chat");
      void send("image", buildImagePrompt(card, draft), selected);
      return;
    }
    if (!draft.trim()) return;
    setComposeIntent("chat");
    void send();
  }

  function edit(c: DialogueCard) {
    setSelected(c.id);
    setEditTitle(c.title);
    setEditBody(c.body);
    setEditorOpen(true);
  }
  function closeEditor() {
    if (
      !dirty ||
      window.confirm("Закрыть редактор без сохранения введённых правок?")
    )
      setEditorOpen(false);
  }
  function newChat() {
    if (busy) return;
    current.current = null;
    setThread(null);
    setDraft("");
    setSelected("");
    setError("");
    setProfileMode(false);
    setMobileMenu(false);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* optional cache */
    }
    input.current?.focus();
  }
  async function save(c: DialogueCard, schedule = false) {
    await perform(async () => {
      const result = await mutate("save", { cardId: c.id });
      setNotice("Сохранено в материалах");
      if (schedule && result.generation) {
        const g = result.generation;
        propsRef.current.onSchedule({
          generationId: g.id,
          title: g.title,
          body: g.body,
          imageUrl: g.imageUrl,
        });
      }
    });
  }
  const disabled = busy || processing || loading;

  function renderCard(c: DialogueCard) {
    const saved = c.savedSnapshot && sameCard(c, c.savedSnapshot);
    return (
      <article
        id={`klio-chat-card-${c.id}`}
        className={`klio-chat-card ${selected === c.id ? "is-selected" : ""}`}
        key={c.id}
      >
        <div className="klio-chat-card-meta">
          <span>
            {c.kind === "topic"
              ? "Тема"
              : c.kind === "note"
                ? "Заметка"
                : "Публикация"}
          </span>
          <span>
            {saved
              ? "✓ В материалах"
              : c.savedId
                ? "Есть изменения"
                : "В диалоге"}
          </span>
        </div>
        <button
          className="klio-chat-card-title"
          onClick={() => setSelected(c.id)}
          aria-pressed={selected === c.id}
        >
          {c.title}
        </button>
        {/* Full text, not a truncated "…" preview with no way to read the
            rest (site owner: "она обрезается... без возможности прочитать
            целиком... как в гпт или клоде") - a generated article is the
            actual point of this card, not a summary of it. */}
        <p>{c.body}</p>
        {c.imageUrl && (
          <Image
            unoptimized
            width={640}
            height={640}
            className="klio-chat-image"
            src={c.imageUrl}
            alt={`Изображение: ${c.title}`}
          />
        )}
        <div className="klio-chat-card-actions">
          <button disabled={disabled} onClick={() => edit(c)}>
            Редактировать
          </button>
          <button disabled={disabled} onClick={() => void save(c)}>
            {saved
              ? "Сохранено ✓"
              : c.savedId
                ? "Сохранить изменения"
                : "В материалы"}
          </button>
          {c.kind === "topic" ? (
            <>
              <button
                disabled={disabled}
                title="Короткий текст для соцсетей, ~600-900 знаков"
                onClick={() =>
                  void send(
                    "chat",
                    `Напиши короткий пост для соцсетей на тему «${c.title}», примерно 600–900 знаков с пробелами, обычными абзацами без подзаголовков. ${c.body}`,
                    c.id,
                  )
                }
              >
                Пост
              </button>
              <button
                disabled={disabled}
                title="Развёрнутый текст с подзаголовками, ~3000-4500 знаков"
                onClick={() =>
                  void send(
                    "chat",
                    `Напиши развёрнутую статью на тему «${c.title}», примерно 3000–4500 знаков с пробелами, с подзаголовками по смыслу. ${c.body}`,
                    c.id,
                  )
                }
              >
                Статья
              </button>
            </>
          ) : (
            <>
              <button disabled={disabled} onClick={() => void save(c, true)}>
                {c.imageUrl ? "В публикацию" : "Запланировать"}
              </button>
              {/* One button, not two indistinguishable ones (site owner:
                  "чем отличаются эти две кнопки?" - they didn't, in any way
                  a user could predict: one used the draft box as a
                  fallback-only prompt ignoring the article, the other
                  always used the article ignoring the draft box). Always
                  grounds the image in the article's own title+body, and
                  folds in whatever's typed in the draft box as optional
                  extra guidance instead of a silent either/or. */}
              <button
                disabled={disabled || !imageAvailable}
                title={
                  !imageAvailable
                    ? "Генерация изображений ещё не подключена. Загрузите картинку в редакторе."
                    : "Одна картинка использует одну генерацию тарифа"
                }
                onClick={() => void send("image", buildImagePrompt(c, draft), c.id)}
              >
                Создать картинку
              </button>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <div
      className={`klio-chat ${mobileMenu ? "menu-open" : ""}`}
      hidden={!props.visible}
    >
    <aside className="klio-chat-sidebar" aria-label="Диалоги и материалы">
      <button className="klio-chat-menu" aria-label="Закрыть список диалогов" onClick={() => setMobileMenu(false)}>Закрыть ×</button>
        <div className="klio-chat-business">
          <span>Ваш бизнес</span>
          {props.brands.length ? (
            <div className="klio-chat-brand-picker">
              <button type="button" className="klio-chat-business-trigger" aria-label={`Активный бизнес: ${props.brandName || "Личное пространство"}`} title={props.brandName || "Личное пространство"} aria-expanded={brandMenuOpen} onClick={() => setBrandMenuOpen(open => !open)} disabled={busy}><span className="klio-chat-business-name">{props.brandName || "Личное пространство"}</span><span className="klio-chat-business-chevron" aria-hidden="true">⌄</span></button>
              {brandMenuOpen && <div className="klio-chat-brand-options" role="group" aria-label="Выберите бизнес">
                {props.brands.map(b => <button type="button" key={b.id} className={props.brandId === b.id ? "active" : ""} title={b.name} onClick={() => { setBrandMenuOpen(false); props.onBrandChange(b.id); }}><span>{b.name}</span></button>)}
              </div>}
            </div>
          ) : (
            <b>Личное пространство</b>
          )}
        </div>
        <button className="klio-chat-new" onClick={newChat} disabled={busy}>
          ＋ Новый диалог
        </button>
        <nav>
          <button onClick={() => props.onNavigate("brand")}>
            ◇ Мой бизнес
          </button>
          <button onClick={() => props.onNavigate("history")}>
            ▤ Материалы
          </button>
          <button onClick={() => props.onNavigate("publications")}>
            ▦ Календарь
          </button>
        </nav>
        <div className="klio-chat-history">
          <span>Диалоги</span>
          {threads.map((t) => (
            <button
              className={thread?.id === t.id ? "active" : ""}
              key={t.id}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await loadThread(t.id);
                  setMobileMenu(false);
                })
              }
              title={t.title}
            >
              {t.status === "processing" ? "◌ " : ""}
              {t.title}
            </button>
          ))}
          {next && (
            <button
              disabled={busy}
              onClick={() => void perform(() => listThreads(next))}
            >
              Показать ещё
            </button>
          )}
        </div>
        <div className="klio-chat-sidebar-bottom">
          <button
            onClick={() => {
              setProfileMode(true);
              setDraft("Помоги настроить профиль моего бизнеса. ");
              input.current?.focus();
              setMobileMenu(false);
            }}
          >
            Настроить бизнес с КЛИО
          </button>
          <a href="/account">Тариф и аккаунт</a>
        </div>
      </aside>
      <section className="klio-chat-main" aria-label="Общение с КЛИО">
        <header className="klio-chat-top">
          <button
            className="klio-chat-menu"
            aria-label="Открыть список диалогов"
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            ☰
          </button>
          <div className="klio-chat-title">
            {titleEditing ? (
              <input
                autoFocus
                value={titleDraft}
                maxLength={80}
                aria-label="Название диалога"
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); commitTitle(); }
                  if (event.key === "Escape") setTitleEditing(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="klio-chat-title-button"
                disabled={!thread || busy}
                title="Переименовать диалог"
                onClick={() => { setTitleDraft(thread?.title || ""); setTitleEditing(true); }}
              >
                {thread?.title || "Новый диалог"}
              </button>
            )}
          </div>
          {Boolean(thread?.data.cards.length) && (
            <div className="klio-chat-cards-menu">
              <button
                type="button"
                aria-expanded={cardMenuOpen}
                aria-label="Все карточки этого диалога"
                onClick={() => setCardMenuOpen((open) => !open)}
              >
                Карточки ({thread!.data.cards.length})
              </button>
              {cardMenuOpen && (
                <div className="klio-chat-cards-options" role="group" aria-label="Карточки диалога">
                  {thread!.data.cards.map((c) => (
                    <button type="button" key={c.id} onClick={() => jumpToCard(c.id)}>
                      <span>{c.kind === "topic" ? "Тема" : c.kind === "note" ? "Заметка" : "Публикация"}</span>
                      <b>{c.title}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            disabled={busy || !thread}
            onClick={() => thread && void perform(() => loadThread(thread.id))}
          >
            Обновить
          </button>
        </header>
        <div className="klio-chat-messages" aria-busy={processing || loading}>
          {loading ? (
            <p className="klio-chat-loading">Открываем диалоги…</p>
          ) : !thread?.data.messages.length ? (
            <div className="klio-chat-welcome">
              <div className="klio-chat-mark">к.</div>
              <h1>Что сделаем сегодня?</h1>
              <p>Обсудим идею, найдём темы или подготовим публикацию.</p>
              <div className="klio-chat-suggestions">
                {[
                  "Предложи темы для моего бизнеса",
                  "Помоги написать пост",
                  "Подготовим публикации на неделю",
                  "Хочу обсудить идею",
                ].map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      setDraft(text);
                      input.current?.focus();
                    }}
                  >
                    {text}
                    <span>↗</span>
                  </button>
                ))}
              </div>
              {!props.brandId && (
                <button
                  className="klio-chat-onboarding"
                  onClick={() => {
                    setProfileMode(true);
                    setDraft("");
                    input.current?.focus();
                  }}
                >
                  Расскажите о бизнесе — КЛИО настроит профиль →
                </button>
              )}
            </div>
          ) : (
            thread.data.messages.map((m) => (
              <div key={m.id} className={`klio-chat-message ${m.role}`}>
                <span className="klio-chat-author">
                  {m.role === "assistant" ? "КЛИО" : "Вы"}
                </span>
                <div className="klio-chat-message-text">{m.text}</div>
                {m.cardIds
                  ?.map((id) => thread.data.cards.find((c) => c.id === id))
                  .filter((c): c is DialogueCard => Boolean(c))
                  .map(renderCard)}
                {m.cardIds && m.cardIds.length > 1 && <button className="klio-chat-note" disabled={disabled} onClick={() => void perform(async () => {
                  for (const id of m.cardIds!) await mutate("save", { cardId: id });
                  setNotice("Подборка сохранена: каждая тема доступна в материалах отдельно");
                })}>Сохранить всю подборку в материалы</button>}
                {m.profile && (
                  <div className="klio-chat-profile">
                    <b>Предлагаемый профиль бизнеса</b>
                    <dl>
                      {Object.entries(m.profile)
                        .filter(([, value]) => value)
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>
                              {{
                                name: "Название",
                                website: "Сайт",
                                description: "О бизнесе",
                                positioning: "Позиционирование",
                                audience: "Аудитория",
                                voice: "Голос бренда",
                                restrictions: "Ограничения",
                                advantages: "Преимущества",
                                products: "Продукты",
                                services: "Услуги",
                                proof: "Подтверждения",
                                geography: "География",
                                vocabulary: "Лексика",
                                cta: "Призыв к действию",
                                signature: "Подпись",
                                prohibited: "Не использовать",
                              }[key] || key}
                            </dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                    {m.action === "profile" && (
                      <>
                        <p>
                          Заполним пустые поля. Ваши предыдущие настройки
                          сохранятся.
                        </p>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void perform(() =>
                              mutate("profile", { messageId: m.id }),
                            )
                          }
                        >
                          Всё верно, сохранить профиль
                        </button>
                        <button
                          disabled={disabled}
                          onClick={() => {
                            setDraft("Исправь предложенный профиль: ");
                            setProfileMode(true);
                            input.current?.focus();
                          }}
                        >
                          Уточнить
                        </button>
                      </>
                    )}
                  </div>
                )}
                {m.role === "assistant" && !m.cardIds?.length && !m.profile && (
                  <button
                    className="klio-chat-note"
                    disabled={disabled}
                    onClick={() =>
                      void perform(async () => {
                        await mutate("note", { messageId: m.id });
                        setNotice("Ответ сохранён в материалах как заметка");
                      })
                    }
                  >
                    Сохранить как заметку
                  </button>
                )}
              </div>
            ))
          )}
          {processing && (
            <div className="klio-chat-thinking" role="status">
              <span />
              КЛИО работает над ответом. Можно перейти в другой диалог.
            </div>
          )}
          <div ref={end} />
        </div>
        <div className="klio-chat-compose">
          {(error || thread?.error) && (
            <div className="klio-chat-error" role="alert">
              {error || thread?.error}
              {thread?.status === "failed" && (
                <button
                  disabled={busy}
                  onClick={() => {
                    const last = thread.data.messages
                      .filter((m) => m.role === "user")
                      .at(-1);
                    if (last) setDraft(last.text);
                  }}
                >
                  Вернуть сообщение в поле ввода
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="klio-chat-notice" role="status">
              {notice}{" "}
              <button onClick={() => props.onNavigate("history")}>
                Открыть материалы
              </button>
            </div>
          )}
          {card && (
            <div className="klio-chat-selection">
              <span>
                Работаем с: <b>{card.title}</b>
              </span>
              <button
                aria-label="Снять выбор материала"
                onClick={() => setSelected("")}
              >
                ×
              </button>
            </div>
          )}
          {profileMode && (
            <div className="klio-chat-selection">
              <span>
                Настройка бизнеса: вставьте сайт или опишите, что предлагаете и
                кому.
              </span>
              <button
                aria-label="Отменить настройку бизнеса"
                onClick={() => setProfileMode(false)}
              >
                ×
              </button>
            </div>
          )}
          {/* ChatGPT-style task picker (site owner: "мы реально путаем
              человека предлагая ему кучу настроек разом") - chat stays plain
              by default; "+" picks a task and only then shows the 2-3
              settings that actually apply to it, instead of all 6 at once. */}
          <div className="klio-chat-intent">
            <button
              type="button"
              className="klio-chat-intent-add"
              aria-haspopup="menu"
              aria-expanded={intentMenuOpen}
              aria-label="Выбрать задачу"
              onClick={() => setIntentMenuOpen((open) => !open)}
            >
              ＋
            </button>
            {composeIntent !== "chat" && (
              <span className="klio-chat-intent-chip">
                {INTENT_OPTIONS.find((option) => option.value === composeIntent)?.label}
                <button type="button" aria-label="Вернуться к обычному общению" onClick={() => setComposeIntent("chat")}>×</button>
              </span>
            )}
            {intentMenuOpen && (
              <div className="klio-chat-intent-menu" role="menu" aria-label="Выберите задачу">
                <button type="button" role="menuitem" className={composeIntent === "chat" ? "active" : ""} onClick={() => { setComposeIntent("chat"); setIntentMenuOpen(false); }}>
                  <b>Просто общение</b><small>Обсудить идею, задать вопрос</small>
                </button>
                {INTENT_OPTIONS.map((option) => (
                  <button type="button" role="menuitem" key={option.value} className={composeIntent === option.value ? "active" : ""} onClick={() => { setComposeIntent(option.value); setIntentMenuOpen(false); }}>
                    <b>{option.label}</b><small>{option.hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          {composeIntent !== "chat" && (
            <div className="klio-chat-settings-grid">
              {composeIntent === "topics" && <>
                <ModuleSelect variant="dialogue" label="Формат" value={genFormat} options={FORMAT_OPTIONS} onChange={(value) => setGenFormat(value as ContentFormat | "")}/>
                <ModuleSelect variant="dialogue" label="Тем при подборе" value={topicCount} options={TOPIC_COUNT_OPTIONS} onChange={setTopicCount}/>
              </>}
              {composeIntent === "text" && <>
                <ModuleSelect variant="dialogue" label="Формат" value={genFormat} options={FORMAT_OPTIONS} onChange={(value) => setGenFormat(value as ContentFormat | "")}/>
                <ModuleSelect variant="dialogue" label="Тон" value={genTone} options={TONE_OPTIONS} onChange={(value) => setGenTone(value as ContentTone | "")}/>
                <ModuleSelect variant="dialogue" label="Объём" value={genLength} options={LENGTH_OPTIONS} onChange={setGenLength}/>
              </>}
              {composeIntent === "image" && <>
                <ModuleSelect variant="dialogue" label="Соотношение картинки" value={imageAspectRatio} options={IMAGE_ASPECT_OPTIONS} onChange={setImageAspectRatio}/>
                <ModuleSelect variant="dialogue" label="Формат картинки" value={imageOutputFormat} options={IMAGE_FORMAT_OPTIONS} onChange={setImageOutputFormat}/>
              </>}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCompose();
            }}
          >
            <textarea
              ref={input}
              aria-label="Сообщение КЛИО"
              placeholder={
                profileMode
                  ? "Ссылка на сайт или несколько слов о вашем бизнесе…"
                  : composeIntent === "image"
                    ? (card ? "Пожелания к изображению (необязательно)…" : "Опишите, что изобразить…")
                    : "Спросите КЛИО или опишите задачу…"
              }
              maxLength={8000}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  window.matchMedia("(min-width: 761px)").matches
                ) {
                  e.preventDefault();
                  submitCompose();
                }
              }}
            />
            <div className="klio-chat-compose-tools">
              {props.brandId && <label className="klio-chat-context"><input type="checkbox" checked={useBrandContext} onChange={e => setUseBrandContext(e.target.checked)} disabled={busy}/> Профиль бренда</label>}
              <label>
                <input
                  type="checkbox"
                  checked={search}
                  onChange={(e) => setSearch(e.target.checked)}
                />
                Поиск в интернете
              </label>
              <button
                type="submit"
                aria-label="Отправить сообщение"
                disabled={disabled || !draft.trim()}
              >
                ↑
              </button>
            </div>
          </form>
          <small>
            Доступно {props.remaining} ответов · изображение расходует одну генерацию.
          </small>
        </div>
      </section>
      <dialog
        ref={editor}
        className="klio-chat-editor"
        onCancel={(e) => {
          e.preventDefault();
          closeEditor();
        }}
      >
        {card && (
          <>
            <header>
              <b>Редактор материала</b>
              <button
                aria-label="Закрыть редактор"
                disabled={busy}
                onClick={closeEditor}
              >
                ×
              </button>
            </header>
            {error && <div className="klio-chat-error" role="alert">{error}</div>}
            <label>
              Название
              <input
                value={editTitle}
                maxLength={500}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </label>
            <label>
              Текст
              <textarea
                value={editBody}
                maxLength={30000}
                onChange={(e) => setEditBody(e.target.value)}
              />
            </label>
            {card.imageUrl && (
              <Image
                unoptimized
                width={640}
                height={640}
                className="klio-chat-image"
                src={card.imageUrl}
                alt={card.title}
              />
            )}
            <footer>
              <button disabled={busy || !editTitle.trim() || !editBody.trim()} onClick={() => void perform(async () => {
                if (dirty) await mutate("edit", { title: editTitle, body: editBody });
                const result = await mutate("save");
                if (result.generation) { setEditorOpen(false); propsRef.current.onProfessional(result.generation); }
              })}>В профессиональный редактор</button>
              <button
                disabled={busy || !editTitle.trim() || !editBody.trim()}
                onClick={() =>
                  void perform(async () => {
                    await mutate("edit", { title: editTitle, body: editBody });
                    setEditorOpen(false);
                    setNotice(
                      "Правки сохранены в диалоге. Нажмите «В материалы», чтобы обновить библиотеку.",
                    );
                  })
                }
              >
                Применить правки
              </button>
              <button
                disabled={busy || dirty || !card.versions.length}
                onClick={() =>
                  void perform(async () => {
                    const r = await mutate("undo");
                    const c = r.thread.data.cards.find(
                      (c) => c.id === selected,
                    )!;
                    setEditTitle(c.title);
                    setEditBody(c.body);
                  })
                }
              >
                Отменить изменение
              </button>
              <button
                disabled={busy || dirty}
                onClick={() =>
                  void perform(async () => {
                    await mutate("copy");
                    setEditorOpen(false);
                  })
                }
              >
                Создать копию
              </button>
              <label className="klio-chat-upload">
                Загрузить картинку
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={busy || dirty}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void perform(async () => {
                      const form = new FormData();
                      form.set("file", file);
                      const response = await fetch("/api/uploads", {
                        method: "POST",
                        body: form,
                      });
                      const result = await response.json();
                      if (!response.ok)
                        throw new Error(
                          result.error || "Не удалось загрузить картинку",
                        );
                      await mutate("attach", { imageUrl: result.url });
                    });
                    e.target.value = "";
                  }}
                />
              </label>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
