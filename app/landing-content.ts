import { PLAN_RULES, type PlanId } from "./plans";
import { PLAN_PRICES, type BillingPeriod } from "./billing-pricing";

export const landingFaq = [
  {
    question: "КЛИО просто генерирует текст по одному запросу?",
    answer: "Нет. Платформа учитывает профиль компании, выбранные ключи, материалы конкурентов, формат и голос бренда, а если подключена семантика — ещё и подтверждённый поисковый спрос. Поэтому результат формируется как редакционный материал под конкретную бизнес‑задачу, а не текст по одному запросу.",
  },
  {
    question: "Можно ли редактировать готовый материал?",
    answer: "Да. Заголовок и основной текст доступны для редактирования прямо в рабочем поле. Поле автоматически увеличивается по мере добавления текста, а после правок материал можно скопировать или экспортировать.",
  },
  {
    question: "Служебный комментарий копируется вместе со статьёй?",
    answer: "Нет. Параметры генерации и редакционный комментарий находятся в отдельном блоке и не входят в текст при копировании.",
  },
  {
    question: "Подходит ли сервис для нескольких компаний?",
    answer: "Да. Тариф «Профи» поддерживает до 5 брендов, «Агентство» — до 10. Статьи, семантика, планы и конкурентные исследования каждого бренда хранятся в его собственном разделе «Материалы». На всех тарифах предусмотрен доступ одного пользователя.",
  },
  {
    question: "Как расходуются лимиты?",
    answer: "Создание статьи, поста, рекламы или текста для сайта расходует один материал. Семантика, контент‑план и анализ конкурентов расходуют по одному исследованию. AI‑доработка текста или пакетная замена до пяти тем расходует одно редакторское действие. Ручные правки, сохранение, открытие, копирование и экспорт бесплатны.",
  },
  {
    question: "Можно ли начать без готового семантического ядра?",
    answer: "Да. Достаточно указать тему или основной запрос. КЛИО поможет собрать связанные поисковые фразы, понять задачу читателя и использовать выбранные запросы в материале. Точные показатели спроса появляются только при подключённом поисковом источнике.",
  },
];

// Prices themselves come from PLAN_PRICES (billing-pricing.ts) — the same
// source the account cabinet and /invoice use — so this marketing copy can
// never drift from what a customer is actually charged there. The limit
// numbers used to be a separate hand-typed string here that could silently
// drift from PLAN_RULES (app/plans.ts), the numbers actually enforced —
// found during the 2026-09-20 quota rework, alongside adding the dialogue
// pool that wasn't mentioned here at all before. Built from PLAN_RULES
// directly now; only the landing-page-only fields (description, features)
// stay hand-written here.
const formatPlanLimit = (value: number) => value.toLocaleString("ru-RU");
const planLimitSummary = (rule: (typeof PLAN_RULES)[PlanId]) =>
  `${formatPlanLimit(rule.generationLimit)} материалов · ${formatPlanLimit(rule.researchLimit)} исследований · ${formatPlanLimit(rule.editorActionLimit)} AI‑правок · ${formatPlanLimit(rule.dialogueActionLimit)} диалоговых ответов`;
export const landingPricing = [
  {
    name: PLAN_PRICES.start.name,
    description: "Для эксперта и небольшого проекта",
    monthly: PLAN_PRICES.start.monthly,
    yearly: PLAN_PRICES.start.yearly,
    limit: planLimitSummary(PLAN_RULES.start),
    planId: "start" as PlanId,
    features: ["Все форматы контента: тексты, изображения и карусели", "Автопубликации", "Диалог с ИИ на любые вопросы", "1 профиль бренда", "1 пользователь", "Семантика, контент‑план и конкуренты", "Редакторы КЛИО, материалы и экспорт"],
  },
  {
    name: PLAN_PRICES.pro.name,
    description: "Для маркетолога и контент‑команды",
    monthly: PLAN_PRICES.pro.monthly,
    yearly: PLAN_PRICES.pro.yearly,
    limit: planLimitSummary(PLAN_RULES.pro),
    planId: "pro" as PlanId,
    features: ["Все форматы контента: тексты, изображения и карусели", "Автопубликации", "Диалог с ИИ на любые вопросы", "5 профилей бренда", "1 пользователь", "Семантика, контент‑план и конкуренты", "Редакторы КЛИО, материалы и экспорт"],
  },
  {
    name: PLAN_PRICES.agency.name,
    description: "Для нескольких клиентов и процессов",
    monthly: PLAN_PRICES.agency.monthly,
    yearly: PLAN_PRICES.agency.yearly,
    planId: "agency" as PlanId,
    limit: planLimitSummary(PLAN_RULES.agency),
    features: ["Все форматы контента: тексты, изображения и карусели", "Автопубликации", "Диалог с ИИ на любые вопросы", "10 профилей бренда", "1 пользователь", "Семантика, контент‑план и конкуренты", "Редакторы КЛИО, материалы и экспорт"],
    popular: true,
  },
];

// Short labels for the 4-way billing-period toggle — BILLING_PERIODS'
// own .label ("3 месяца", "12 месяцев"...) reads fine as a single dropdown
// option (see account/billing-actions.tsx) but is too wide for four
// side-by-side segments here.
export const BILLING_TOGGLE_LABELS: Record<BillingPeriod, string> = {
  monthly: "Месяц",
  quarterly: "3 мес",
  halfyear: "6 мес",
  annual: "Год",
};

