import { presentQuestion, validateDefinition } from "@lizon/shared";
import { cleanHtml } from "../../common/html";

export interface LessonBlock {
  id: string;
  type: "markdown" | "cards" | "quiz" | "simulation";
  text?: string;
  cards?: { id: string; front: string; back: string }[];
  simulation?: "logistic" | "line";
  title?: string;
  questions?: { id: string; type: string; text: string; definition: unknown }[];
}

export interface LessonContent {
  format?: "markdown" | "html";
  body?: string;
  videoUrl?: string;
  videoFileId?: string;
  attachments?: { fileId: string; name: string }[];
  link?: string;
  blocks?: LessonBlock[];
}

export function sanitizeIncomingContent(content: LessonContent | null | undefined): LessonContent | null {
  if (!content) return null;
  const next: LessonContent = { ...content };
  if (next.format === "html" && typeof next.body === "string") next.body = cleanHtml(next.body);
  if (Array.isArray(next.blocks)) {
    next.blocks = next.blocks.map((block) => {
      if (block.type !== "quiz" || !block.questions) return block;
      return {
        ...block,
        questions: block.questions.map((question) => {
          validateDefinition(question.type, question.definition);
          return question;
        }),
      };
    });
  }
  return next;
}

/** Ученику не отдаём правильные ответы встроенных мини-квизов. */
export function presentContent(content: unknown, teacher: boolean): unknown {
  if (!content || typeof content !== "object" || teacher) return content;
  const source = content as LessonContent;
  if (!Array.isArray(source.blocks)) return content;
  return {
    ...source,
    blocks: source.blocks.map((block) => {
      if (block.type !== "quiz" || !block.questions) return block;
      return {
        ...block,
        questions: block.questions.map((question) => {
          const view = presentQuestion({ type: question.type, prompt: question.text, definition: question.definition });
          return { id: question.id, type: question.type, text: question.text, widget: view.widget, payload: view.payload, presentation: view.presentation };
        }),
      };
    }),
  };
}
