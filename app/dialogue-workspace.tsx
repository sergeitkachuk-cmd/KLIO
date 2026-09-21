"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  sameCard,
  type DialogueCard,
  type DialogueThread,
} from "./dialogue-model";
import { ModuleSelect } from "./module-select";
import { ImageLightbox } from "./image-lightbox";
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
// gpt-image-1 only renders three real sizes (square/landscape/portrait,
// see _lib/image-generation.ts) - offering 5 distinctly-labelled ratios
// that collapse into the same 3 actual outputs was exactly the confusion
// site owner caught here ("ты говорил, что там всего 3 соотношения, а тут
// пять и они разные"). One representative value per real size; the stored
// value is still one of ImageAspectRatio's 5 literals, just picked to be
// honest about what comes back.
const IMAGE_ASPECT_OPTIONS = [
  { value: "1:1", label: "Квадрат" },
  { value: "4:3", label: "Альбомная" },
  { value: "9:16", label: "Портретная" },
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
  hasLogo: boolean;
  dialogueRemaining: number;
  researchRemaining: number;
  generationsRemaining: number;
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
  const [profileMode, setProfileMode] = useState(false);
  const [useBrandContext, setUseBrandContext] = useState(false);
  const [selected, setSelected] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageAvailable, setImageAvailable] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
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
  const [useLogoInImage, setUseLogoInImage] = useState(false);
  // Replaces one always-visible settings panel (site owner: "мы реально
  // путаем человека предлагая ему кучу настроек разом") with a ChatGPT-
  // style "+" picker: chat stays plain by default, and choosing a task
  // surfaces only the settings that apply to it - формат+количество for a
  // topic list, тон+объём for text, соотношение+формат for an image. Resets
  // to "chat" after every send, same as ChatGPT's own tool picker - each
  // message chooses its own task fresh instead of a sticky mode.
  const [composeIntent, setComposeIntent] = useState<"chat" | "topics" | "text" | "image">("chat");
  // Whether the settings grid for the current intent is expanded, separate
  // from composeIntent itself - clicking outside used to reset composeIntent
  // straight to "chat" to hide the grid, which also silently threw away the
  // chosen task itself (site owner: "настройки закрылись, но режим генерации
  // картинки изменился на стандартный диалог" - tapping empty space to
  // dismiss the panel should not also un-pick "image" and make the next
  // send land as a plain chat message). Collapsing now only hides the grid;
  // the chip stays and can be tapped to expand it again.
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [intentMenuOpen, setIntentMenuOpen] = useState(false);
  // Portaled + position:fixed, not a plain CSS dropdown (site owner: "меню
  // выпадает за экран" - the trigger sits in the compose row at the very
  // bottom of the chat column, so a plain top:100% dropdown almost always
  // has nowhere below to open into). Always opens upward, unlike
  // ModuleSelect's up/down measurement - this trigger's position relative
  // to the viewport bottom barely changes, so there's no real "open
  // downward" case worth deciding between (site owner: "выпадающее меню
  // вверх, как у гпт").
  const [intentMenuRect, setIntentMenuRect] = useState<{ bottom: number; left: number; width: number; maxHeight: number } | null>(null);
  const intentContainerRef = useRef<HTMLDivElement>(null);
  const intentTriggerRef = useRef<HTMLButtonElement>(null);
  const intentMenuRef = useRef<HTMLDivElement>(null);
  const composeFormRef = useRef<HTMLFormElement>(null);
  const settingsGridRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!intentMenuOpen) return;
    const measure = () => {
      if (!intentTriggerRef.current) return;
      const rect = intentTriggerRef.current.getBoundingClientRect();
      const edgeGap = 12;
      const maxHeight = Math.max(160, Math.min(360, rect.top - edgeGap));
      // Sized off the compose field itself, not a flat px value (site
      // owner: a fixed 240px truncated every label+hint hard - "текст не
      // влезает весь") - full width of the field on mobile, half on web,
      // still clamped to the viewport as a last-resort safety net.
      const formWidth = composeFormRef.current?.getBoundingClientRect().width || 320;
      const isMobile = window.innerWidth <= 760;
      const width = Math.min(isMobile ? formWidth : formWidth / 2, window.innerWidth - edgeGap * 2);
      const left = Math.min(rect.left, window.innerWidth - width - edgeGap);
      setIntentMenuRect({ bottom: window.innerHeight - rect.top + 8, left, width, maxHeight });
    };
    measure();
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (intentContainerRef.current?.contains(target) || intentMenuRef.current?.contains(target)) return;
      setIntentMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIntentMenuOpen(false);
    };
    const reposition = (event: Event) => {
      if (intentMenuRef.current?.contains(event.target as Node)) return;
      measure();
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [intentMenuOpen]);
  // The settings grid (aspect ratio/format/logo, tone/length, etc.) and its
  // chip only had an explicit "×" to dismiss - clicking anywhere else left
  // it sitting open indefinitely (site owner: "нажимаешь указать
  // характеристики картинки, а она потом не закрывается"). Clicking inside
  // the compose form itself (typing the message, using the dropdowns)
  // must not count as "outside" - only closes when the click actually
  // lands elsewhere (a card, the message list, etc). The dropdowns' own
  // option lists and the intent menu are portaled to document.body, so
  // they're not DOM descendants of either ref - matched by class instead.
  useEffect(() => {
    if (composeIntent === "chat" || !settingsExpanded) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (settingsGridRef.current?.contains(target) || composeFormRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".klio-chat-intent-menu, .module-select-list")) return;
      setSettingsExpanded(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [composeIntent, settingsExpanded]);
  // Mobile sidebar drawer - previously closable only through its own "×"
  // (site owner: "нажимаешь боковое меню... закрыть можно только через
  // кнопку закрыть"). No backdrop element exists behind it (see the
  // .menu-open CSS), so this same click-outside pattern closes it instead
  // of adding one.
  useEffect(() => {
    if (!mobileMenu) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sidebarRef.current?.contains(target)) return;
      setMobileMenu(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [mobileMenu]);
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
        useBrandContext: profileMode || (Boolean(props.brandId) && useBrandContext),
        settings: {
          format: genFormat || undefined,
          tone: genTone || undefined,
          length: genLength || undefined,
          topicCount: Number(topicCount),
          imageAspectRatio,
          imageOutputFormat,
          useLogo: props.hasLogo && useLogoInImage,
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
    const intent = composeIntent;
    setComposeIntent("chat");
    void send(intent === "topics" || intent === "text" ? intent : undefined);
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
        // A truly standalone image card has title/body holding the
        // generation PROMPT, not real post content - carrying that through
        // unchanged put prompt text into the publication (site owner: "в
        // поле публикации не было никакого текста, но в телеграме он
        // опубликовал вместе с текстом запроса генерации картинки").
        // Keying this on imageUrl alone (as an earlier fix here did) blanked
        // a REAL post's own text too once an image got attached to it,
        // since that card also has imageUrl set (site owner, catching that
        // regression directly: "нажимаю в публикацию под картинкой которая
        // заменила текст и этот текст в публикацию не подтягивается").
        // Empty body is what's actually unique to the standalone case (see
        // the server's own comment in dialogue/route.ts).
        const isPureImage = Boolean(g.imageUrl) && !g.body?.trim();
        propsRef.current.onSchedule({
          generationId: g.id,
          title: isPureImage ? "" : g.title,
          body: isPureImage ? "" : g.body,
          imageUrl: g.imageUrl,
        });
      }
    });
  }
  const disabled = busy || processing || loading;

  function renderCard(c: DialogueCard) {
    const saved = c.savedSnapshot && sameCard(c, c.savedSnapshot);
    // A card can have an image two different ways: generated standalone
    // (no real text, just the prompt captured for the archive - empty
    // body, see the server's own comment) or attached to an already-real
    // post (reviseCard keeps that post's title/body exactly as they were).
    // Hiding title/body for every c.imageUrl card, standalone or not, made
    // a real post's own text disappear the moment an image got attached to
    // it (site owner: "текст поста... заменился картинкой, а сам пропал").
    const isPureImage = Boolean(c.imageUrl) && !c.body.trim();
    return (
      <article
        id={`klio-chat-card-${c.id}`}
        className={`klio-chat-card ${selected === c.id ? "is-selected" : ""}`}
        key={c.id}
      >
        <div className="klio-chat-card-meta">
          <span>
            {/* A standalone generation (no source card) fills both title
                and body from the same typed description, so an image card
                used to show that description twice, styled like an
                article's heading and lead paragraph (site owner, pointing
                at exactly this: "почему отдельную генерацию воспринимает
                как текстовую публикацию?"). Fixed by moving the "this is
                an image" label into this existing small status row - a
                dedicated heading above the image ate space for a label
                nobody needed to read that large (site owner: "зачем
                надпись изображение? она столько места съедает над
                картинкой"), and selecting an image card as context
                contributes nothing useful to a follow-up prompt anyway
                (its title/body carry no real text - see below). */}
            {isPureImage
              ? "Изображение"
              : c.kind === "topic"
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
        {!isPureImage && (
          <button
            className="klio-chat-card-title"
            onClick={() => setSelected(c.id)}
            aria-pressed={selected === c.id}
          >
            {c.title}
          </button>
        )}
        {/* Full text, not a truncated "…" preview with no way to read the
            rest (site owner: "она обрезается... без возможности прочитать
            целиком... как в гпт или клоде") - a generated article is the
            actual point of this card, not a summary of it. Not shown for
            a pure-image card - it has no real body text, just the empty
            string (see the server's newCard branch in dialogue/route.ts).
            A real post that also has an image attached still shows its
            own text here. */}
        {!isPureImage && <p>{c.body}</p>}
        {c.imageUrl && (
          <button
            type="button"
            className="klio-chat-image-trigger"
            aria-label="Открыть изображение крупнее"
            onClick={() => setLightboxUrl(c.imageUrl)}
          >
            <Image
              unoptimized
              width={640}
              height={640}
              className="klio-chat-image"
              src={c.imageUrl}
              alt={`Изображение: ${c.title}`}
            />
          </button>
        )}
        <div className="klio-chat-card-actions">
          {/* A pure-image card has no text to edit - "Редактировать" opened
              this dialogue's own title/body editor regardless, which then
              showed the image PROMPT in those fields with no image
              anywhere (site owner: "он ее видимо оценивает как текст...
              текст запроса генерации картинки распределяет в заголовок и
              текст... есть текст запроса, но нет картинки самой"). Offer
              the one action that actually applies to an image instead. A
              real post that also has an image attached still gets the
              normal text actions - it has real text to edit. */}
          {isPureImage ? (
            <a className="klio-chat-card-download" href={c.imageUrl} download>
              <span aria-hidden="true">⬇</span> Скачать
            </a>
          ) : (
            <button disabled={disabled} onClick={() => edit(c)}>
              Редактировать
            </button>
          )}
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
                    "text",
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
                    "text",
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
                {c.imageUrl ? <><span aria-hidden="true">→</span> В публикацию</> : "Запланировать"}
              </button>
              {/* Not offered when the card already IS a generated image -
                  "создать картинку" on an image made no sense there (site
                  owner: same report as above) and duplicates the "+"
                  picker's own image intent for a fresh one. One button, not
                  two indistinguishable ones, for the text case (site owner:
                  "чем отличаются эти две кнопки?" - they didn't, in any way
                  a user could predict: one used the draft box as a
                  fallback-only prompt ignoring the article, the other
                  always used the article ignoring the draft box). Always
                  grounds the image in the article's own title+body, and
                  folds in whatever's typed in the draft box as optional
                  extra guidance instead of a silent either/or. */}
              {!c.imageUrl && (
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
              )}
            </>
          )}
        </div>
      </article>
    );
  }

  // A card that gets an image attached (or is otherwise revised) after its
  // own introduction is referenced from two different messages - the one
  // that first created it, and the one whose action just touched it - and
  // thread.data.cards always holds its current, single copy either way.
  // Rendering "whatever message references this card ID" without tracking
  // what's already been shown printed the same up-to-date card a second
  // time under the later message too (site owner: "получается странно, что
  // картинка появляется дважды"). Declared once per render, mutated in
  // order as the message list below is walked top to bottom.
  const shownCardIds = new Set<string>();

  return (
    <div
      className={`klio-chat ${mobileMenu ? "menu-open" : ""}`}
      hidden={!props.visible}
    >
    <aside className="klio-chat-sidebar" aria-label="Диалоги и материалы" ref={sidebarRef}>
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
                {/* Nothing signalled the title was clickable at all (site
                    owner: "непонятно, что есть такая функция") - a pencil
                    is the standard "this is renameable" cue and only shows
                    once a real thread exists to rename. */}
                {thread && <i className="klio-chat-title-edit" aria-hidden="true"/>}
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
                  .filter((c) => !shownCardIds.has(c.id) && shownCardIds.add(c.id))
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
          {composeIntent !== "chat" && settingsExpanded && (
            <div className="klio-chat-settings-grid" ref={settingsGridRef}>
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
                {props.hasLogo ? (
                  <label className="klio-chat-logo-toggle"><input type="checkbox" checked={useLogoInImage} onChange={(event) => setUseLogoInImage(event.target.checked)}/> Использовать логотип бренда</label>
                ) : (
                  <button type="button" className="klio-chat-logo-suggest" onClick={() => props.onNavigate("brand")}>Загрузить логотип бренда →</button>
                )}
              </>}
            </div>
          )}
          <form
            ref={composeFormRef}
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
              onFocus={(e) => {
                // On some mobile browsers, 100dvh doesn't settle to its new
                // (keyboard-shrunk) value until after the keyboard's own
                // open animation finishes, so the compose bar can end up
                // sitting below the actually-visible area right when it's
                // most needed (site owner: "поле ввода иногда проваливается
                // ниже экрана и надо прокручивать"). A delayed scrollIntoView
                // (after that animation, not before it) pulls the field back
                // into view without waiting on dvh to catch up on its own.
                const field = e.currentTarget;
                window.setTimeout(() => field.scrollIntoView({ block: "end", behavior: "smooth" }), 300);
              }}
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
              {/* ChatGPT-style task picker (site owner: "мы реально путаем
                  человека предлагая ему кучу настроек разом") - chat stays
                  plain by default; "+" picks a task and only then shows the
                  2-3 settings that actually apply to it. Portaled +
                  position:fixed (site owner: "меню выпадает за экран") -
                  this trigger sits at the very bottom of the chat column, so
                  a plain CSS dropdown almost never has room to open below
                  it; always opens upward instead, like ChatGPT's own. */}
              <div className="klio-chat-intent" ref={intentContainerRef}>
                <button
                  type="button"
                  ref={intentTriggerRef}
                  className="klio-chat-intent-add"
                  aria-haspopup="menu"
                  aria-expanded={intentMenuOpen}
                  aria-label="Выбрать задачу"
                  onClick={() => setIntentMenuOpen((open) => !open)}
                >
                  ＋
                </button>
                {intentMenuOpen && intentMenuRect && createPortal(
                  <div
                    className="klio-chat-intent-menu"
                    role="menu"
                    aria-label="Выберите задачу"
                    ref={intentMenuRef}
                    style={{ position: "fixed", bottom: intentMenuRect.bottom, left: intentMenuRect.left, width: intentMenuRect.width, maxHeight: intentMenuRect.maxHeight }}
                  >
                    <button type="button" role="menuitem" className={composeIntent === "chat" ? "active" : ""} onClick={() => { setComposeIntent("chat"); setIntentMenuOpen(false); }}>
                      <b>Просто общение</b><small>Обсудить идею, задать вопрос</small>
                    </button>
                    {INTENT_OPTIONS.map((option) => (
                      <button type="button" role="menuitem" key={option.value} className={composeIntent === option.value ? "active" : ""} onClick={() => { setComposeIntent(option.value); setSettingsExpanded(true); setIntentMenuOpen(false); }}>
                        <b>{option.label}</b><small>{option.hint}</small>
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>
              {composeIntent !== "chat" && (
                <span className="klio-chat-intent-chip">
                  <button type="button" className="klio-chat-intent-chip-label" onClick={() => setSettingsExpanded((value) => !value)} aria-expanded={settingsExpanded} aria-label="Показать или скрыть настройки">
                    {INTENT_OPTIONS.find((option) => option.value === composeIntent)?.label}
                  </button>
                  <button type="button" aria-label="Вернуться к обычному общению" onClick={() => setComposeIntent("chat")}>×</button>
                </span>
              )}
              {props.brandId && <label className="klio-chat-context"><input type="checkbox" checked={useBrandContext} onChange={e => setUseBrandContext(e.target.checked)} disabled={busy}/> Профиль бренда</label>}
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
            {/* Three different pools now, matching whichever professional-
                mode equivalent produces the same kind of output (site
                owner: "у нас никак не обозначается и не регулируется в
                тарифе генерация картинок и диалога", "это недосмотр, стоит
                развести") - same labels as the account page's own quota
                bars, not new wording, so the same number reads the same
                way in both places. */}
            Диалог: {props.dialogueRemaining} · Исследования: {props.researchRemaining} · Материалы: {props.generationsRemaining}.
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
              <button
                type="button"
                className="klio-chat-image-trigger"
                aria-label="Открыть изображение крупнее"
                onClick={() => setLightboxUrl(card.imageUrl)}
              >
                <Image
                  unoptimized
                  width={640}
                  height={640}
                  className="klio-chat-image"
                  src={card.imageUrl}
                  alt={card.title}
                />
              </button>
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
      {lightboxUrl && <ImageLightbox src={lightboxUrl} alt="Изображение" onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
