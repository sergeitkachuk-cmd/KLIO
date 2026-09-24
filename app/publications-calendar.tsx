"use client";

import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import ruLocale from "@fullcalendar/react/locales/ru";
import type { CalendarRef, DatesSetInfo, EventClickInfo, EventDisplayInfo, EventDropInfo, EventInput } from "@fullcalendar/react";

export type PubChannel = {
  id: string;
  brandId: string;
  platform: "telegram" | "vk";
  label: string;
  avatarUrl: string;
  createdAt: string;
};

export type PubStatus = "scheduled" | "publishing" | "published" | "failed";

export type PubItem = {
  id: string;
  brandId: string;
  generationId: string;
  channelId: string;
  scheduledAt: string;
  telegramDeliveryMode: "photo_continue" | "text_only";
  status: PubStatus;
  providerPostId: string | null;
  providerPostUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  publishedAt: string | null;
  title: string;
  body: string;
  imageUrl: string;
  channel: PubChannel | null;
};

export type PublicationsCalendarView = "month" | "week" | "list";

type Props = {
  items: PubItem[];
  channels: PubChannel[];
  view: PublicationsCalendarView;
  cursor: Date;
  loading: boolean;
  error: string;
  onViewChange: (view: PublicationsCalendarView) => void;
  onRangeChange: (view: PublicationsCalendarView, start: Date) => void;
  onCreate: (date: Date) => void;
  onOpen: (item: PubItem) => void;
  onMove: (item: PubItem, scheduledAt: string) => Promise<void>;
  onRetry: () => void;
};

const STATUS_LABELS: Record<PubStatus, string> = {
  scheduled: "Запланировано",
  publishing: "Публикуется",
  published: "Опубликовано",
  failed: "Ошибка",
};

const PLATFORM_LABELS: Record<PubChannel["platform"], string> = {
  telegram: "Telegram",
  vk: "VK",
};

function itemTitle(item: PubItem) {
  const value = item.title.trim() || item.body.trim();
  return value.replace(/\s+/g, " ").slice(0, 120) || "Без заголовка";
}

function eventTime(item: PubItem) {
  const date = new Date(item.scheduledAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function PublicationPlatformMark({ platform }: { platform: PubChannel["platform"] | null }) {
  if (platform === "telegram") {
    return <span className="klio-publication-platform-mark klio-publication-platform-mark-telegram" aria-label="Telegram">TG</span>;
  }
  if (platform === "vk") {
    return <span className="klio-publication-platform-mark klio-publication-platform-mark-vk" aria-label="VK">VK</span>;
  }
  return <span className="klio-publication-platform-mark klio-publication-platform-mark-unknown" aria-label="Канал отключён">—</span>;
}

function eventContent(arg: EventDisplayInfo) {
  const item = arg.event.extendedProps.publication as PubItem | undefined;
  if (!item) return <span>{arg.event.title}</span>;
  return (
    <div className="klio-publication-event-content">
      <div className="klio-publication-event-topline">
        <span className="klio-publication-event-time">{arg.timeText || eventTime(item)}</span>
        <PublicationPlatformMark platform={item.channel?.platform ?? null}/>
      </div>
      <strong>{itemTitle(item)}</strong>
      <div className="klio-publication-event-meta">
        <span className="klio-publication-event-channel">{item.channel?.label || "Канал отключён"}</span>
        <span className={`klio-publication-event-status klio-publication-event-status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
      </div>
    </div>
  );
}

function viewName(view: PublicationsCalendarView) {
  if (view === "week") return "timeGridWeek";
  if (view === "list") return "listMonth";
  return "dayGridMonth";
}

export function PublicationsCalendar({
  items,
  channels,
  view,
  cursor,
  loading,
  error,
  onViewChange,
  onRangeChange,
  onCreate,
  onOpen,
  onMove,
  onRetry,
}: Props) {
  const calendarRef = useRef<CalendarRef | null>(null);
  const [channelFilter, setChannelFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | PubChannel["platform"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PubStatus>("all");

  const availablePlatforms = useMemo(
    () => [...new Set(channels.map((channel) => channel.platform))],
    [channels],
  );

  const activeChannelFilter = channelFilter === "all" || channels.some((channel) => channel.id === channelFilter) ? channelFilter : "all";
  const activePlatformFilter = platformFilter === "all" || availablePlatforms.includes(platformFilter) ? platformFilter : "all";

  const filteredItems = useMemo(
    () => items.filter((item) => {
      if (activeChannelFilter !== "all" && item.channelId !== activeChannelFilter) return false;
      if (activePlatformFilter !== "all" && item.channel?.platform !== activePlatformFilter) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      return true;
    }),
    [activeChannelFilter, activePlatformFilter, items, statusFilter],
  );

  const events = useMemo<EventInput[]>(
    () => filteredItems.map((item) => ({
      id: item.id,
      title: itemTitle(item),
      start: item.scheduledAt,
      allDay: false,
      editable: item.status === "scheduled",
      classNames: [
        "klio-publication-event",
        `klio-publication-event-${item.status}`,
        `klio-publication-event-${item.channel?.platform || "unknown"}`,
      ],
      extendedProps: { publication: item },
    })),
    [filteredItems],
  );

  function handleDatesSet(info: DatesSetInfo) {
    const nextView: PublicationsCalendarView = info.view.type === "timeGridWeek"
      ? "week"
      : info.view.type === "listMonth"
        ? "list"
        : "month";
    onRangeChange(nextView, info.view.currentStart);
  }

  function handleEventClick(info: EventClickInfo) {
    info.jsEvent.preventDefault();
    const item = info.event.extendedProps.publication as PubItem | undefined;
    if (item) onOpen(item);
  }

  async function handleEventDrop(info: EventDropInfo) {
    const item = info.event.extendedProps.publication as PubItem | undefined;
    if (!item || item.status !== "scheduled" || !info.event.start) {
      info.revert();
      return;
    }
    try {
      await onMove(item, info.event.start.toISOString());
    } catch {
      info.revert();
    }
  }

  const statusCount = filteredItems.length;
  const hasAnyItems = items.length > 0;

  return (
    <section className="klio-publications-calendar" aria-label="Календарь публикаций">
      <div className="klio-publications-calendar-toolbar">
        <div className="klio-publications-view-switch" role="group" aria-label="Вид календаря">
          {(["month", "week", "list"] as PublicationsCalendarView[]).map((item) => (
            <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => onViewChange(item)}>
              {item === "month" ? "Месяц" : item === "week" ? "Неделя" : "Список"}
            </button>
          ))}
        </div>
        <div className="klio-publications-filters" aria-label="Фильтры публикаций">
          {channels.length > 0 && <label>
            <span>Канал / профиль</span>
            <select value={activeChannelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
              <option value="all">Все каналы</option>
              {channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.label}</option>)}
            </select>
          </label>}
          {availablePlatforms.length > 1 && <label>
            <span>Соцсеть</span>
            <select value={activePlatformFilter} onChange={(event) => setPlatformFilter(event.target.value as "all" | PubChannel["platform"])}>
              <option value="all">Все площадки</option>
              {availablePlatforms.map((platform) => <option value={platform} key={platform}>{PLATFORM_LABELS[platform]}</option>)}
            </select>
          </label>}
          <label>
            <span>Статус</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | PubStatus)}>
              <option value="all">Все статусы</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <span className="klio-publications-filter-count" aria-live="polite">
            {statusCount} {statusCount === 1 ? "публикация" : statusCount >= 2 && statusCount <= 4 ? "публикации" : "публикаций"}
          </span>
        </div>
      </div>

      {error && <div className="klio-publications-calendar-error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={onRetry}>Повторить</button>
      </div>}

      {!loading && !hasAnyItems && <div className="klio-publications-calendar-empty" role="status">
        <strong>В этом календаре пока нет публикаций</strong>
        <span>Добавьте запись кнопкой выше или нажмите на дату, чтобы открыть редактор.</span>
      </div>}
      {!loading && hasAnyItems && !filteredItems.length && <div className="klio-publications-calendar-empty" role="status">
        <strong>По выбранным фильтрам ничего не найдено</strong>
        <span>Измените фильтры, чтобы увидеть публикации.</span>
      </div>}

      <div className={`klio-publications-calendar-frame ${loading ? "is-loading" : ""}`}>
        <FullCalendar
          key={view}
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
          initialView={viewName(view)}
          initialDate={cursor}
          locales={[ruLocale]}
          locale="ru"
          firstDay={1}
          headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
          events={events}
          eventContent={eventContent}
          eventClick={handleEventClick}
          eventDrop={(info) => void handleEventDrop(info)}
          dateClick={(info) => onCreate(info.date)}
          datesSet={handleDatesSet}
          editable
          eventDurationEditable={false}
          eventResizableFromStart={false}
          longPressDelay={300}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          dayMaxEventRows={4}
          noEventsText="На этот период публикаций нет"
          aspectRatio={1.8}
          height="auto"
          contentHeight="auto"
          allDaySlot={false}
        />
        {loading && <div className="klio-publications-calendar-loading" role="status">Загружаем публикации…</div>}
      </div>
      <p className="klio-publications-calendar-hint">Нажмите на публикацию, чтобы открыть редактор. Запланированные записи можно перенести мышью на другую дату и время.</p>
    </section>
  );
}
