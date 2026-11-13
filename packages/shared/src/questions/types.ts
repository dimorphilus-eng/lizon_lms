export type Locale = "ru" | "en";

export type FeedbackMode = "immediate" | "deferred" | "closed" | "adaptive";

export type Widget =
  | "info"
  | "choices"
  | "boolean"
  | "text"
  | "number"
  | "essay"
  | "match"
  | "order"
  | "cloze"
  | "hotspot"
  | "imageDrop"
  | "gaps"
  | "scale";

export interface QuestionValidationErrorShape {
  code: string;
  details?: Record<string, string | number>;
}

export class QuestionValidationError extends Error {
  code: string;
  details?: Record<string, string | number>;

  constructor(code: string, details?: Record<string, string | number>) {
    super(code);
    this.name = "QuestionValidationError";
    this.code = code;
    this.details = details;
  }
}

export interface GradeContext {
  locale?: Locale;
  dataset?: Record<string, number> | null;
  /** true на окончательной отправке адаптивной попытки */
  finalized?: boolean;
}

export interface MaterializeContext {
  shuffle: boolean;
  random?: () => number;
}

export interface RawGrade {
  fraction: number;
  feedback?: string;
  needsManual?: boolean;
  parts?: { id: string; fraction: number; feedback?: string }[];
}

export interface GradeResult {
  fraction: number;
  score: number;
  maxScore: number;
  feedback?: string;
  needsManual: boolean;
  parts?: { id: string; fraction: number; feedback?: string }[];
  wrongTries: number;
  locked: boolean;
}

export interface SolutionView {
  summary: string;
  choiceIds?: string[];
  value?: string | boolean | number;
  order?: string[];
  pairs?: { stemId: string; optionId: string }[];
  gaps?: { id: string; value: string; label: string }[];
  regions?: { id: string; shape: string; coords: number[] }[];
}

export interface PublicQuestion {
  type: string;
  widget: Widget;
  presentation?: "select" | "drag";
  prompt: string;
  payload: Record<string, unknown>;
}

export interface QuestionPlugin {
  type: string;
  label: { ru: string; en: string };
  manual: boolean;
  graded: boolean;
  validate(definition: unknown): void;
  emptyDefinition(): unknown;
  materialize?(definition: unknown, ctx: MaterializeContext): { definition: unknown; dataset?: Record<string, number> | null };
  publicView(definition: unknown, ctx: GradeContext): { widget: Widget; presentation?: "select" | "drag"; payload: Record<string, unknown> };
  grade(definition: unknown, response: unknown, ctx: GradeContext): RawGrade;
  solution(definition: unknown, ctx: GradeContext): SolutionView;
}

export interface ImportedQuestion {
  type: string;
  name: string;
  text: string;
  defaultMark: number;
  penalty: number;
  generalFeedback: string;
  definition: unknown;
  tags: string[];
}

export interface ExportQuestion extends ImportedQuestion {}
