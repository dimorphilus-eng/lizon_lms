import { QuestionValidationError, type Locale, type RawGrade } from "./types";

export function fail(code: string, details?: Record<string, string | number>): never {
  throw new QuestionValidationError(code, details);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, code = "definition_invalid"): Record<string, unknown> {
  if (!isRecord(value)) fail(code);
  return value;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function fraction(value: unknown, code = "fraction_invalid"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) fail(code);
  return value;
}

export function plainText(value: unknown, code = "text_required"): string {
  if (typeof value !== "string" || value.trim() === "") fail(code);
  return value;
}

export function uniqueIds(ids: string[], code = "ids_not_unique"): void {
  if (new Set(ids).size !== ids.length) fail(code);
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function defaultFeedback(fraction: number, locale: Locale = "ru"): string {
  if (fraction >= 0.999) return locale === "en" ? "Correct." : "Верно.";
  if (fraction > 0) return locale === "en" ? "Partially correct." : "Частично верно.";
  return locale === "en" ? "Incorrect." : "Неверно.";
}

export function localeOf(locale?: Locale): Locale {
  return locale === "en" ? "en" : "ru";
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export function httpUrl(value: unknown, code = "url_invalid"): string {
  if (typeof value !== "string" || value.trim() === "") fail(code);
  const url = value.trim();
  if (url.startsWith("/")) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(code);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(code);
  return url;
}

export function manualPending(locale: Locale): RawGrade {
  return {
    fraction: 0,
    needsManual: true,
    feedback: locale === "en" ? "Waiting for the teacher." : "Ответ ожидает проверки преподавателя.",
  };
}

export function instantiateText(text: string, dataset?: Record<string, number> | null): string {
  if (!dataset) return text;
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (full, name: string) =>
    Object.prototype.hasOwnProperty.call(dataset, name) ? String(dataset[name]) : full,
  );
}

export const VALIDATION_TEXT: Record<string, { ru: string; en: string }> = {
  definition_invalid: { ru: "Определение вопроса заполнено неверно.", en: "The question definition is invalid." },
  choices_min: { ru: "Нужно минимум два варианта ответа.", en: "Add at least two choices." },
  fraction_invalid: { ru: "Доля балла должна быть от −1 до 1.", en: "A grade fraction must be between -1 and 1." },
  text_required: { ru: "Текст не может быть пустым.", en: "Text is required." },
  ids_not_unique: { ru: "Идентификаторы должны быть уникальными.", en: "Identifiers must be unique." },
  single_needs_correct: { ru: "Отметьте хотя бы один верный вариант.", en: "Mark at least one correct choice." },
  answers_min: { ru: "Добавьте хотя бы один правильный ответ.", en: "Add at least one accepted answer." },
  tolerance_invalid: { ru: "Допуск должен быть неотрицательным числом.", en: "Tolerance must be a non-negative number." },
  pairs_min: { ru: "Нужно минимум две пары соответствия.", en: "Add at least two matching pairs." },
  items_min: { ru: "Нужно минимум два элемента.", en: "Add at least two items." },
  gaps_min: { ru: "Добавьте хотя бы один пропуск.", en: "Add at least one gap." },
  gap_missing: { ru: "В тексте нет метки пропуска.", en: "The template is missing a gap marker." },
  option_missing: { ru: "Пропуск ссылается на несуществующий вариант.", en: "A gap points at a missing option." },
  formula_invalid: { ru: "Формула не разбирается.", en: "The formula could not be parsed." },
  dataset_invalid: { ru: "Набор данных не покрывает переменные.", en: "A dataset is missing a variable." },
  datasets_min: { ru: "Добавьте хотя бы один набор значений.", en: "Add at least one dataset." },
  region_invalid: { ru: "Область на изображении задана неверно.", en: "An image region is invalid." },
  url_invalid: { ru: "Нужна ссылка http(s) или путь к файлу.", en: "Use an http(s) URL or a file path." },
  range_invalid: { ru: "Диапазон шкалы задан неверно.", en: "The scale range is invalid." },
  unknown_type: { ru: "Неизвестный тип вопроса.", en: "Unknown question type." },
};

export function explainValidation(code: string, locale: Locale = "ru"): string {
  return VALIDATION_TEXT[code]?.[locale] ?? code;
}
