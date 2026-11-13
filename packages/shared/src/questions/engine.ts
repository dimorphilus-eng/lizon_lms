import { FormulaError, assertFormula, evaluateFormula } from "../formula";
import { wildcardMatch } from "../wildcard";
import type {
  GradeContext,
  GradeResult,
  MaterializeContext,
  PublicQuestion,
  QuestionPlugin,
  RawGrade,
  SolutionView,
} from "./types";
import { QuestionValidationError } from "./types";
import {
  asRecord,
  clamp01,
  defaultFeedback,
  fail,
  fraction,
  httpUrl,
  isRecord,
  localeOf,
  manualPending,
  parseNumber,
  plainText,
  shuffle,
  uniqueIds,
  wordCount,
} from "./util";

const plugins = new Map<string, QuestionPlugin>();

export function registerQuestionPlugin(plugin: QuestionPlugin): void {
  if (plugins.has(plugin.type)) throw new Error(`Question type already registered: ${plugin.type}`);
  plugins.set(plugin.type, plugin);
}

export function getQuestionPlugin(type: string): QuestionPlugin {
  const plugin = plugins.get(type);
  if (!plugin) throw new QuestionValidationError("unknown_type", { type });
  return plugin;
}

export function listQuestionTypes(): Pick<QuestionPlugin, "type" | "label" | "manual" | "graded">[] {
  return [...plugins.values()].map(({ type, label, manual, graded }) => ({ type, label, manual, graded }));
}

export function validateDefinition(type: string, definition: unknown): void {
  getQuestionPlugin(type).validate(definition);
}

export function emptyDefinition(type: string): unknown {
  return getQuestionPlugin(type).emptyDefinition();
}

export function materializeQuestion(
  type: string,
  definition: unknown,
  ctx: MaterializeContext,
): { definition: unknown; dataset?: Record<string, number> | null } {
  const plugin = getQuestionPlugin(type);
  if (!plugin.materialize) return { definition, dataset: null };
  return plugin.materialize(definition, ctx);
}

export function presentQuestion(input: {
  type: string;
  prompt: string;
  definition: unknown;
  dataset?: Record<string, number> | null;
}): PublicQuestion {
  const plugin = getQuestionPlugin(input.type);
  const view = plugin.publicView(input.definition, { dataset: input.dataset });
  return {
    type: input.type,
    widget: view.widget,
    presentation: view.presentation,
    prompt: input.prompt,
    payload: view.payload,
  };
}

export function solveQuestion(input: {
  type: string;
  definition: unknown;
  dataset?: Record<string, number> | null;
  locale?: "ru" | "en";
}): SolutionView {
  return getQuestionPlugin(input.type).solution(input.definition, {
    dataset: input.dataset,
    locale: input.locale,
  });
}

export function gradeQuestion(input: {
  type: string;
  definition: unknown;
  response: unknown;
  maxScore: number;
  penalty?: number;
  wrongTries?: number;
  mode?: "immediate" | "deferred" | "closed" | "adaptive";
  dataset?: Record<string, number> | null;
  locale?: "ru" | "en";
  finalized?: boolean;
}): GradeResult {
  const plugin = getQuestionPlugin(input.type);
  const raw = plugin.grade(input.definition, input.response, {
    locale: input.locale,
    dataset: input.dataset,
    finalized: input.finalized,
  });
  const penalty = input.penalty ?? 0;
  let wrongTries = input.wrongTries ?? 0;
  let fractionValue = clamp01(raw.fraction);
  let locked = false;

  // В адаптивном режиме штраф списывается за каждую неверную проверку.
  // Верный ответ с n ошибками до него даёт max(0, 1 − penalty·n).
  if (input.mode === "adaptive" && !raw.needsManual && plugin.graded) {
    if (fractionValue >= 0.999) {
      fractionValue = clamp01(1 - penalty * wrongTries);
      locked = true;
    } else if (!input.finalized) {
      wrongTries += 1;
      fractionValue = 0;
    } else {
      fractionValue = clamp01(fractionValue - penalty * wrongTries);
    }
  }

  const maxScore = plugin.graded ? input.maxScore : 0;
  return {
    fraction: plugin.graded ? fractionValue : 0,
    score: plugin.graded ? fractionValue * input.maxScore : 0,
    maxScore,
    feedback: raw.feedback,
    needsManual: Boolean(raw.needsManual),
    parts: raw.parts,
    wrongTries,
    locked,
  };
}

function feedbackOf(explicit: string | undefined, fractionValue: number, ctx: GradeContext): string {
  if (explicit && explicit.trim()) return explicit;
  return defaultFeedback(fractionValue, localeOf(ctx.locale));
}

function choiceResponse(response: unknown): string[] {
  if (!isRecord(response) || !Array.isArray(response.choiceIds)) return [];
  return response.choiceIds.filter((id): id is string => typeof id === "string");
}

const multichoice: QuestionPlugin = {
  type: "multichoice",
  label: { ru: "Множественный выбор", en: "Multiple choice" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    single: true,
    choices: [
      { id: "a", text: "", fraction: 1, feedback: "" },
      { id: "b", text: "", fraction: 0, feedback: "" },
    ],
  }),
  validate(definition) {
    const data = asRecord(definition);
    if (typeof data.single !== "boolean") fail("definition_invalid");
    if (!Array.isArray(data.choices) || data.choices.length < 2) fail("choices_min");
    const ids: string[] = [];
    let positive = 0;
    for (const choice of data.choices) {
      const row = asRecord(choice);
      plainText(row.text);
      ids.push(plainText(row.id, "ids_not_unique"));
      const grade = fraction(row.fraction);
      if (grade > 0) positive += grade;
    }
    uniqueIds(ids);
    if (data.single && positive <= 0) fail("single_needs_correct");
  },
  materialize(definition, ctx) {
    const data = asRecord(definition);
    const choices = Array.isArray(data.choices) ? data.choices.slice() : [];
    return { definition: { ...data, choices: ctx.shuffle ? shuffle(choices, ctx.random) : choices } };
  },
  publicView(definition) {
    const data = asRecord(definition);
    const choices = Array.isArray(data.choices) ? data.choices : [];
    return {
      widget: "choices",
      payload: {
        single: Boolean(data.single),
        choices: choices.map((choice) => {
          const row = asRecord(choice);
          return { id: String(row.id), text: String(row.text ?? "") };
        }),
      },
    };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const choices = (data.choices as Record<string, unknown>[]).map((choice) => asRecord(choice));
    const selected = choiceResponse(response);
    if (data.single) {
      const found = choices.find((choice) => choice.id === selected[0]);
      const value = found ? clamp01(fraction(found.fraction)) : 0;
      return { fraction: value, feedback: feedbackOf(found?.feedback as string | undefined, value, ctx) };
    }
    let sum = 0;
    const notes: string[] = [];
    for (const id of selected) {
      const found = choices.find((choice) => choice.id === id);
      if (!found) continue;
      sum += fraction(found.fraction);
      if (typeof found.feedback === "string" && found.feedback.trim()) notes.push(found.feedback.trim());
    }
    const value = clamp01(sum);
    return { fraction: value, feedback: notes[0] || feedbackOf(undefined, value, ctx) };
  },
  solution(definition, ctx) {
    const data = asRecord(definition);
    const choices = (data.choices as unknown[]).map((choice) => asRecord(choice));
    const correct = choices.filter((choice) => fraction(choice.fraction) > 0);
    const labels = correct.map((choice) => String(choice.text)).join(", ");
    return {
      summary: localeOf(ctx.locale) === "en" ? `Correct: ${labels}` : `Верно: ${labels}`,
      choiceIds: correct.map((choice) => String(choice.id)),
    };
  },
};

const truefalse: QuestionPlugin = {
  type: "truefalse",
  label: { ru: "Верно / неверно", en: "True / false" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({ correct: true }),
  validate(definition) {
    const data = asRecord(definition);
    if (typeof data.correct !== "boolean") fail("definition_invalid");
  },
  publicView() {
    return { widget: "boolean", payload: {} };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const value = isRecord(response) && typeof response.value === "boolean" ? response.value : null;
    const ok = value === data.correct;
    const got = ok ? 1 : 0;
    const specific =
      value === true ? (data.trueFeedback as string | undefined) : value === false ? (data.falseFeedback as string | undefined) : undefined;
    return { fraction: got, feedback: feedbackOf(specific, got, ctx) };
  },
  solution(definition, ctx) {
    const correct = Boolean(asRecord(definition).correct);
    const label = correct
      ? localeOf(ctx.locale) === "en" ? "True" : "Верно"
      : localeOf(ctx.locale) === "en" ? "False" : "Неверно";
    return { summary: label, value: correct };
  },
};

const shortanswer: QuestionPlugin = {
  type: "shortanswer",
  label: { ru: "Короткий ответ", en: "Short answer" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({ caseSensitive: false, answers: [{ text: "", fraction: 1, feedback: "" }] }),
  validate(definition) {
    const data = asRecord(definition);
    if (typeof data.caseSensitive !== "boolean") fail("definition_invalid");
    if (!Array.isArray(data.answers) || data.answers.length === 0) fail("answers_min");
    for (const answer of data.answers) {
      const row = asRecord(answer);
      plainText(row.text);
      fraction(row.fraction);
    }
  },
  publicView() {
    return { widget: "text", payload: {} };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const text = isRecord(response) && typeof response.text === "string" ? response.text.trim() : "";
    let best = 0;
    let note: string | undefined;
    for (const answer of data.answers as unknown[]) {
      const row = asRecord(answer);
      if (!wildcardMatch(String(row.text).trim(), text, Boolean(data.caseSensitive))) continue;
      const value = clamp01(fraction(row.fraction));
      if (value >= best) {
        best = value;
        note = typeof row.feedback === "string" ? row.feedback : undefined;
      }
    }
    return { fraction: best, feedback: feedbackOf(note, best, ctx) };
  },
  solution(definition, ctx) {
    const answers = (asRecord(definition).answers as unknown[]).map((answer) => asRecord(answer));
    const best = answers.reduce((top, answer) => (fraction(answer.fraction) > fraction(top.fraction) ? answer : top));
    const text = String(best.text);
    return {
      summary: localeOf(ctx.locale) === "en" ? `Accepted: ${text}` : `Принимается: ${text}`,
      value: text,
    };
  },
};

function numericalAnswers(definition: unknown) {
  const data = asRecord(definition);
  if (!Array.isArray(data.answers) || data.answers.length === 0) fail("answers_min");
  return data.answers.map((answer) => {
    const row = asRecord(answer);
    const value = parseNumber(row.value);
    if (value === null) fail("definition_invalid");
    const tolerance = typeof row.tolerance === "number" ? row.tolerance : 0;
    if (!Number.isFinite(tolerance) || tolerance < 0) fail("tolerance_invalid");
    const toleranceType = row.toleranceType === "relative" ? "relative" : "absolute";
    return { value, tolerance, toleranceType, fraction: fraction(row.fraction), feedback: row.feedback };
  });
}

function withinTolerance(actual: number, expected: number, tolerance: number, kind: string): boolean {
  const window = kind === "relative" ? Math.abs(expected) * tolerance : tolerance;
  return Math.abs(actual - expected) <= window + 1e-9;
}

const numerical: QuestionPlugin = {
  type: "numerical",
  label: { ru: "Числовой ответ", en: "Numerical" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    unit: "",
    answers: [{ value: 0, tolerance: 0, toleranceType: "absolute", fraction: 1, feedback: "" }],
  }),
  validate(definition) {
    numericalAnswers(definition);
  },
  publicView(definition) {
    const unit = asRecord(definition).unit;
    return { widget: "number", payload: { unit: typeof unit === "string" ? unit : "" } };
  },
  grade(definition, response, ctx) {
    const answers = numericalAnswers(definition);
    const actual = parseNumber(isRecord(response) ? response.value : null);
    if (actual === null) return { fraction: 0, feedback: feedbackOf(undefined, 0, ctx) };
    let best = 0;
    let note: string | undefined;
    for (const answer of answers) {
      if (!withinTolerance(actual, answer.value, answer.tolerance, answer.toleranceType)) continue;
      const value = clamp01(answer.fraction);
      if (value >= best) {
        best = value;
        note = typeof answer.feedback === "string" ? answer.feedback : undefined;
      }
    }
    return { fraction: best, feedback: feedbackOf(note, best, ctx) };
  },
  solution(definition, ctx) {
    const best = numericalAnswers(definition).reduce((top, answer) => (answer.fraction > top.fraction ? answer : top));
    return {
      summary: localeOf(ctx.locale) === "en" ? `Value: ${best.value}` : `Значение: ${best.value}`,
      value: best.value,
    };
  },
};

const essay: QuestionPlugin = {
  type: "essay",
  label: { ru: "Эссе", en: "Essay" },
  manual: true,
  graded: true,
  emptyDefinition: () => ({ minWords: 0, maxWords: null }),
  validate(definition) {
    const data = asRecord(definition);
    if (data.minWords !== undefined && (typeof data.minWords !== "number" || data.minWords < 0)) fail("definition_invalid");
    if (data.maxWords !== undefined && data.maxWords !== null && (typeof data.maxWords !== "number" || data.maxWords < 0)) {
      fail("definition_invalid");
    }
  },
  publicView(definition) {
    const data = asRecord(definition);
    return {
      widget: "essay",
      payload: {
        minWords: typeof data.minWords === "number" ? data.minWords : 0,
        maxWords: typeof data.maxWords === "number" ? data.maxWords : null,
      },
    };
  },
  grade(definition, response, ctx) {
    const text = isRecord(response) && typeof response.text === "string" ? response.text.trim() : "";
    if (!text) return { fraction: 0, needsManual: false, feedback: feedbackOf(undefined, 0, ctx) };
    const data = asRecord(definition);
    const words = wordCount(text);
    const minWords = typeof data.minWords === "number" ? data.minWords : 0;
    const locale = localeOf(ctx.locale);
    const short =
      minWords > 0 && words < minWords
        ? locale === "en"
          ? ` Short of the requested length (${words}/${minWords}).`
          : ` Короче запрошенного объёма (${words}/${minWords}).`
        : "";
    const pending = manualPending(locale);
    return { ...pending, feedback: `${pending.feedback}${short}` };
  },
  solution(_definition, ctx) {
    return { summary: localeOf(ctx.locale) === "en" ? "Graded by the teacher." : "Проверяет преподаватель." };
  },
};

function authoringPairs(definition: unknown) {
  const data = asRecord(definition);
  if (!Array.isArray(data.pairs) || data.pairs.length < 2) fail("pairs_min");
  const pairs = data.pairs.map((pair) => {
    const row = asRecord(pair);
    return { id: plainText(row.id, "ids_not_unique"), stem: plainText(row.stem), answer: plainText(row.answer) };
  });
  uniqueIds(pairs.map((pair) => pair.id));
  const distractors = Array.isArray(data.distractors)
    ? data.distractors.map((item) => plainText(item))
    : [];
  return { pairs, distractors };
}

function materializedMatch(definition: unknown): { stems: { id: string; text: string }[]; options: { id: string; text: string; correctStemId?: string }[] } | null {
  const data = asRecord(definition);
  if (!Array.isArray(data.stems) || !Array.isArray(data.options)) return null;
  return {
    stems: data.stems.map((stem) => {
      const row = asRecord(stem);
      return { id: String(row.id), text: String(row.text ?? "") };
    }),
    options: data.options.map((option) => {
      const row = asRecord(option);
      return {
        id: String(row.id),
        text: String(row.text ?? ""),
        correctStemId: typeof row.correctStemId === "string" ? row.correctStemId : undefined,
      };
    }),
  };
}

function matchingPlugin(type: string, label: { ru: string; en: string }, presentation: "select" | "drag"): QuestionPlugin {
  return {
    type,
    label,
    manual: false,
    graded: true,
    emptyDefinition: () => ({
      pairs: [
        { id: "p1", stem: "", answer: "" },
        { id: "p2", stem: "", answer: "" },
      ],
      distractors: [],
    }),
    validate: (definition) => {
      authoringPairs(definition);
    },
    materialize(definition, ctx) {
      const { pairs, distractors } = authoringPairs(definition);
      let n = 1;
      const options = [
        ...pairs.map((pair) => ({ id: `opt_${n++}`, text: pair.answer, correctStemId: pair.id })),
        ...distractors.map((text) => ({ id: `opt_${n++}`, text })),
      ];
      return {
        definition: {
          stems: pairs.map((pair) => ({ id: pair.id, text: pair.stem })),
          options: ctx.shuffle ? shuffle(options, ctx.random) : options,
        },
      };
    },
    publicView(definition) {
      const ready = materializedMatch(definition);
      const options = ready
        ? ready.options.map(({ id, text }) => ({ id, text }))
        : authoringPairs(definition).pairs.map((pair) => ({ id: pair.id, text: pair.answer }));
      const stems = ready ? ready.stems : authoringPairs(definition).pairs.map((pair) => ({ id: pair.id, text: pair.stem }));
      return { widget: "match", presentation, payload: { stems, options } };
    },
    grade(definition, response, ctx) {
      const ready = materializedMatch(definition);
      const pairs = isRecord(response) && Array.isArray(response.pairs) ? response.pairs : [];
      const picked = new Map<string, string>();
      for (const pair of pairs) {
        if (!isRecord(pair) || typeof pair.stemId !== "string" || typeof pair.optionId !== "string") continue;
        if (!picked.has(pair.stemId)) picked.set(pair.stemId, pair.optionId);
      }
      if (!ready) {
        const authored = authoringPairs(definition);
        let correct = 0;
        const used = new Set<string>();
        for (const pair of authored.pairs) {
          const optionId = picked.get(pair.id);
          if (optionId === pair.id && !used.has(optionId)) {
            correct += 1;
            used.add(optionId);
          }
        }
        const value = authored.pairs.length ? correct / authored.pairs.length : 0;
        return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
      }
      let correct = 0;
      const used = new Set<string>();
      for (const stem of ready.stems) {
        const optionId = picked.get(stem.id);
        const option = ready.options.find((item) => item.id === optionId);
        if (option?.correctStemId === stem.id && optionId && !used.has(optionId)) {
          correct += 1;
          used.add(optionId);
        }
      }
      const value = ready.stems.length ? correct / ready.stems.length : 0;
      return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
    },
    solution(definition, ctx) {
      const ready = materializedMatch(definition);
      if (ready) {
        const pairs = ready.stems.map((stem) => {
          const option = ready.options.find((item) => item.correctStemId === stem.id);
          return { stemId: stem.id, optionId: option?.id ?? "", label: `${stem.text} → ${option?.text ?? ""}` };
        });
        return {
          summary: pairs.map((pair) => pair.label).join("; "),
          pairs: pairs.map(({ stemId, optionId }) => ({ stemId, optionId })),
        };
      }
      const authored = authoringPairs(definition);
      return {
        summary: authored.pairs.map((pair) => `${pair.stem} → ${pair.answer}`).join("; "),
        pairs: authored.pairs.map((pair) => ({ stemId: pair.id, optionId: pair.id })),
      };
    },
  };
}

function gapTemplate(definition: unknown) {
  const data = asRecord(definition);
  const template = plainText(data.template);
  return { data, template };
}

const ddtext: QuestionPlugin = {
  type: "ddtext",
  label: { ru: "Перетаскивание в текст", en: "Drag and drop into text" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    template: "[[1]]",
    gaps: [{ id: "1", correctOptionId: "o1" }],
    options: [
      { id: "o1", text: "" },
      { id: "o2", text: "" },
    ],
  }),
  validate(definition) {
    const { data, template } = gapTemplate(definition);
    if (!Array.isArray(data.gaps) || data.gaps.length === 0) fail("gaps_min");
    if (!Array.isArray(data.options) || data.options.length === 0) fail("choices_min");
    const optionIds = data.options.map((option) => plainText(asRecord(option).id, "ids_not_unique"));
    uniqueIds(optionIds);
    for (const option of data.options) plainText(asRecord(option).text);
    const gapIds: string[] = [];
    for (const gap of data.gaps) {
      const row = asRecord(gap);
      const id = plainText(row.id, "ids_not_unique");
      gapIds.push(id);
      if (!template.includes(`[[${id}]]`)) fail("gap_missing", { id });
      if (!optionIds.includes(String(row.correctOptionId))) fail("option_missing");
    }
    uniqueIds(gapIds);
  },
  materialize(definition, ctx) {
    const data = asRecord(definition);
    const options = Array.isArray(data.options) ? data.options.slice() : [];
    return { definition: { ...data, options: ctx.shuffle ? shuffle(options, ctx.random) : options } };
  },
  publicView(definition) {
    const data = asRecord(definition);
    return {
      widget: "gaps",
      presentation: "drag",
      payload: {
        template: String(data.template ?? ""),
        gaps: (data.gaps as unknown[]).map((gap) => ({ id: String(asRecord(gap).id) })),
        pool: (data.options as unknown[]).map((option) => {
          const row = asRecord(option);
          return { id: String(row.id), text: String(row.text ?? "") };
        }),
      },
    };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const picked = gapPicks(response);
    const gaps = data.gaps as unknown[];
    let correct = 0;
    const used = new Set<string>();
    for (const gap of gaps) {
      const row = asRecord(gap);
      const optionId = picked.get(String(row.id));
      if (optionId && optionId === row.correctOptionId && !used.has(optionId)) {
        correct += 1;
        used.add(optionId);
      }
    }
    const value = gaps.length ? correct / gaps.length : 0;
    return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
  },
  solution(definition, ctx) {
    const data = asRecord(definition);
    const options = new Map((data.options as unknown[]).map((option) => {
      const row = asRecord(option);
      return [String(row.id), String(row.text ?? "")];
    }));
    const gaps = (data.gaps as unknown[]).map((gap) => {
      const row = asRecord(gap);
      const value = String(row.correctOptionId);
      return { id: String(row.id), value, label: options.get(value) ?? value };
    });
    return { summary: gaps.map((gap) => gap.label).join(", "), gaps };
  },
};

const ddimage: QuestionPlugin = {
  type: "ddimage",
  label: { ru: "Перетаскивание на изображение", en: "Drag and drop onto image" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    imageUrl: "https://example.com/diagram.png",
    drops: [{ id: "z1", x: 10, y: 10, w: 30, h: 20, label: "" }],
    drags: [{ id: "d1", text: "", correctDropId: "z1" }],
  }),
  validate(definition) {
    const data = asRecord(definition);
    httpUrl(data.imageUrl);
    if (!Array.isArray(data.drops) || data.drops.length === 0) fail("region_invalid");
    if (!Array.isArray(data.drags) || data.drags.length === 0) fail("items_min");
    const dropIds = data.drops.map((drop) => {
      const row = asRecord(drop);
      assertBox(row);
      return plainText(row.id, "ids_not_unique");
    });
    uniqueIds(dropIds);
    const dragIds: string[] = [];
    for (const drag of data.drags) {
      const row = asRecord(drag);
      dragIds.push(plainText(row.id, "ids_not_unique"));
      plainText(row.text);
      if (!dropIds.includes(String(row.correctDropId))) fail("option_missing");
    }
    uniqueIds(dragIds);
  },
  materialize(definition, ctx) {
    const data = asRecord(definition);
    const drags = Array.isArray(data.drags) ? data.drags.slice() : [];
    return { definition: { ...data, drags: ctx.shuffle ? shuffle(drags, ctx.random) : drags } };
  },
  publicView(definition) {
    const data = asRecord(definition);
    return {
      widget: "imageDrop",
      presentation: "drag",
      payload: {
        imageUrl: String(data.imageUrl ?? ""),
        drops: (data.drops as unknown[]).map((drop) => {
          const row = asRecord(drop);
          return { id: String(row.id), x: row.x, y: row.y, w: row.w, h: row.h, label: row.label ?? "" };
        }),
        drags: (data.drags as unknown[]).map((drag) => {
          const row = asRecord(drag);
          return { id: String(row.id), text: String(row.text ?? "") };
        }),
      },
    };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const placements = isRecord(response) && Array.isArray(response.placements) ? response.placements : [];
    const byDrag = new Map<string, string>();
    for (const placement of placements) {
      if (!isRecord(placement) || typeof placement.dragId !== "string" || typeof placement.dropId !== "string") continue;
      if (!byDrag.has(placement.dragId)) byDrag.set(placement.dragId, placement.dropId);
    }
    const usedDrops = new Set<string>();
    let correct = 0;
    const drags = data.drags as unknown[];
    for (const drag of drags) {
      const row = asRecord(drag);
      const dropId = byDrag.get(String(row.id));
      if (dropId && dropId === row.correctDropId && !usedDrops.has(dropId)) {
        correct += 1;
        usedDrops.add(dropId);
      }
    }
    const value = drags.length ? correct / drags.length : 0;
    return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
  },
  solution(definition) {
    const data = asRecord(definition);
    const summary = (data.drags as unknown[])
      .map((drag) => {
        const row = asRecord(drag);
        return `${row.text} → ${row.correctDropId}`;
      })
      .join("; ");
    return { summary };
  },
};

const ordering: QuestionPlugin = {
  type: "ordering",
  label: { ru: "Порядок", en: "Ordering" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    items: [
      { id: "i1", text: "" },
      { id: "i2", text: "" },
    ],
  }),
  validate(definition) {
    const items = orderingItems(definition);
    if (items.length < 2) fail("items_min");
    uniqueIds(items.map((item) => item.id));
  },
  materialize(definition, ctx) {
    const items = orderingItems(definition);
    const ids = items.map((item) => item.id);
    return { definition: { items, displayOrder: shuffle(ids, ctx.random) } };
  },
  publicView(definition) {
    const items = orderingItems(definition);
    const data = asRecord(definition);
    const display = Array.isArray(data.displayOrder) ? data.displayOrder.map(String) : items.map((item) => item.id);
    const byId = new Map(items.map((item) => [item.id, item.text]));
    return {
      widget: "order",
      presentation: "drag",
      payload: { items: display.filter((id) => byId.has(id)).map((id) => ({ id, text: byId.get(id) })) },
    };
  },
  grade(definition, response, ctx) {
    const items = orderingItems(definition);
    const order = isRecord(response) && Array.isArray(response.order) ? response.order.filter((id): id is string => typeof id === "string") : [];
    let correct = 0;
    items.forEach((item, index) => {
      if (order[index] === item.id) correct += 1;
    });
    const value = items.length ? correct / items.length : 0;
    return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
  },
  solution(definition) {
    const items = orderingItems(definition);
    return { summary: items.map((item) => item.text).join(" → "), order: items.map((item) => item.id) };
  },
};

function orderingItems(definition: unknown): { id: string; text: string }[] {
  const data = asRecord(definition);
  if (!Array.isArray(data.items)) fail("items_min");
  return data.items.map((item) => {
    const row = asRecord(item);
    return { id: plainText(row.id, "ids_not_unique"), text: plainText(row.text) };
  });
}

const description: QuestionPlugin = {
  type: "description",
  label: { ru: "Описание", en: "Description" },
  manual: false,
  graded: false,
  emptyDefinition: () => ({ text: "" }),
  validate(definition) {
    const data = asRecord(definition);
    if (data.text !== undefined && typeof data.text !== "string") fail("definition_invalid");
  },
  publicView(definition) {
    const text = asRecord(definition).text;
    return { widget: "info", payload: { text: typeof text === "string" ? text : "" } };
  },
  grade() {
    return { fraction: 0, needsManual: false };
  },
  solution() {
    return { summary: "" };
  },
};

type ClozeGap =
  | { id: string; type: "shortanswer"; weight: number; caseSensitive?: boolean; answers: { text: string; fraction: number }[] }
  | { id: string; type: "numerical"; weight: number; answers: { value: number; tolerance: number; toleranceType: string; fraction: number }[] }
  | { id: string; type: "multichoice"; weight: number; choices: { id: string; text: string; fraction: number }[] };

function clozeGaps(definition: unknown): { template: string; gaps: ClozeGap[] } {
  const data = asRecord(definition);
  const template = plainText(data.template);
  if (!Array.isArray(data.gaps) || data.gaps.length === 0) fail("gaps_min");
  const gaps: ClozeGap[] = data.gaps.map((gap) => parseClozeGap(gap, template));
  uniqueIds(gaps.map((gap) => gap.id));
  return { template, gaps };
}

function parseClozeGap(gap: unknown, template: string): ClozeGap {
  const row = asRecord(gap);
  const id = plainText(row.id, "ids_not_unique");
  if (!template.includes(`[[${id}]]`)) fail("gap_missing", { id });
  const weight = typeof row.weight === "number" && row.weight > 0 ? row.weight : 1;
  if (row.type === "shortanswer") {
    if (!Array.isArray(row.answers) || row.answers.length === 0) fail("answers_min");
    return {
      id,
      type: "shortanswer",
      weight,
      caseSensitive: Boolean(row.caseSensitive),
      answers: row.answers.map((answer) => {
        const item = asRecord(answer);
        return { text: plainText(item.text), fraction: fraction(item.fraction) };
      }),
    };
  }
  if (row.type === "numerical") {
    if (!Array.isArray(row.answers) || row.answers.length === 0) fail("answers_min");
    return {
      id,
      type: "numerical",
      weight,
      answers: row.answers.map((answer) => {
        const item = asRecord(answer);
        const value = parseNumber(item.value);
        if (value === null) fail("definition_invalid");
        const tolerance = typeof item.tolerance === "number" ? item.tolerance : 0;
        if (tolerance < 0) fail("tolerance_invalid");
        return {
          value,
          tolerance,
          toleranceType: item.toleranceType === "relative" ? "relative" : "absolute",
          fraction: fraction(item.fraction),
        };
      }),
    };
  }
  if (row.type === "multichoice") {
    if (!Array.isArray(row.choices) || row.choices.length < 2) fail("choices_min");
    const choices = row.choices.map((choice) => {
      const item = asRecord(choice);
      return { id: plainText(item.id, "ids_not_unique"), text: plainText(item.text), fraction: fraction(item.fraction) };
    });
    uniqueIds(choices.map((choice) => choice.id));
    return { id, type: "multichoice", weight, choices };
  }
  fail("definition_invalid");
}

const cloze: QuestionPlugin = {
  type: "cloze",
  label: { ru: "Вложенные ответы", en: "Embedded answers (Cloze)" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    template: "[[1]]",
    gaps: [{ id: "1", type: "shortanswer", weight: 1, caseSensitive: false, answers: [{ text: "", fraction: 1 }] }],
  }),
  validate(definition) {
    clozeGaps(definition);
  },
  materialize(definition, ctx) {
    const parsed = clozeGaps(definition);
    const gaps = parsed.gaps.map((gap) => {
      if (gap.type !== "multichoice" || !ctx.shuffle) return gap;
      return { ...gap, choices: shuffle(gap.choices, ctx.random) };
    });
    return { definition: { template: parsed.template, gaps } };
  },
  publicView(definition) {
    const parsed = clozeGaps(definition);
    return {
      widget: "cloze",
      payload: {
        template: parsed.template,
        gaps: parsed.gaps.map((gap) => {
          if (gap.type === "multichoice") {
            return { id: gap.id, kind: "choice", choices: gap.choices.map(({ id, text }) => ({ id, text })) };
          }
          return { id: gap.id, kind: gap.type === "numerical" ? "number" : "text" };
        }),
      },
    };
  },
  grade(definition, response, ctx) {
    const parsed = clozeGaps(definition);
    const picks = gapValueMap(response);
    let weighted = 0;
    let weightSum = 0;
    const parts: RawGrade["parts"] = [];
    for (const gap of parsed.gaps) {
      const value = picks.get(gap.id) ?? "";
      const part = gradeClozeGap(gap, value);
      weighted += part * gap.weight;
      weightSum += gap.weight;
      parts.push({ id: gap.id, fraction: part });
    }
    const total = weightSum ? weighted / weightSum : 0;
    return { fraction: total, feedback: feedbackOf(undefined, total, ctx), parts };
  },
  solution(definition) {
    const parsed = clozeGaps(definition);
    const gaps = parsed.gaps.map((gap) => {
      if (gap.type === "shortanswer") {
        const best = gap.answers.reduce((top, answer) => (answer.fraction > top.fraction ? answer : top));
        return { id: gap.id, value: best.text, label: best.text };
      }
      if (gap.type === "numerical") {
        const best = gap.answers.reduce((top, answer) => (answer.fraction > top.fraction ? answer : top));
        return { id: gap.id, value: String(best.value), label: String(best.value) };
      }
      const correct = gap.choices.filter((choice) => choice.fraction > 0);
      const label = correct.map((choice) => choice.text).join(", ");
      return { id: gap.id, value: correct[0]?.id ?? "", label };
    });
    return { summary: gaps.map((gap) => gap.label).join(", "), gaps };
  },
};

function gradeClozeGap(gap: ClozeGap, value: string): number {
  if (gap.type === "shortanswer") {
    let best = 0;
    for (const answer of gap.answers) {
      if (wildcardMatch(answer.text.trim(), value.trim(), Boolean(gap.caseSensitive))) best = Math.max(best, clamp01(answer.fraction));
    }
    return best;
  }
  if (gap.type === "numerical") {
    const actual = parseNumber(value);
    if (actual === null) return 0;
    let best = 0;
    for (const answer of gap.answers) {
      if (withinTolerance(actual, answer.value, answer.tolerance, answer.toleranceType)) best = Math.max(best, clamp01(answer.fraction));
    }
    return best;
  }
  const choice = gap.choices.find((item) => item.id === value);
  return choice ? clamp01(choice.fraction) : 0;
}

function readDatasets(data: Record<string, unknown>, variables: string[]): Record<string, number>[] {
  if (!Array.isArray(data.datasets) || data.datasets.length === 0) fail("datasets_min");
  return data.datasets.map((dataset) => {
    const row = asRecord(dataset);
    const next: Record<string, number> = {};
    for (const name of variables) {
      const value = parseNumber(row[name]);
      if (value === null) fail("dataset_invalid", { name });
      next[name] = value;
    }
    return next;
  });
}

function calculatedBase(definition: unknown) {
  const data = asRecord(definition);
  if (!Array.isArray(data.variables) || data.variables.some((name) => typeof name !== "string")) fail("definition_invalid");
  const variables = data.variables as string[];
  const tolerance = typeof data.tolerance === "number" ? data.tolerance : 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) fail("tolerance_invalid");
  const toleranceType = data.toleranceType === "relative" ? "relative" : "absolute";
  const formula = plainText(data.formula);
  try {
    assertFormula(formula, variables);
  } catch (error) {
    if (error instanceof FormulaError) fail("formula_invalid");
    throw error;
  }
  const datasets = readDatasets(data, variables);
  return { data, variables, tolerance, toleranceType, formula, datasets };
}

const calculated: QuestionPlugin = {
  type: "calculated",
  label: { ru: "Вычисляемый", en: "Calculated" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    formula: "{a}+{b}",
    tolerance: 0,
    toleranceType: "absolute",
    variables: ["a", "b"],
    datasets: [{ a: 1, b: 2 }],
    unit: "",
  }),
  validate(definition) {
    calculatedBase(definition);
  },
  materialize(definition, ctx) {
    const base = calculatedBase(definition);
    const index = Math.floor((ctx.random ?? Math.random)() * base.datasets.length);
    const picked = base.datasets[index];
    return {
      definition: { ...base.data, datasets: [picked] },
      dataset: picked,
    };
  },
  publicView(definition) {
    const unit = asRecord(definition).unit;
    return { widget: "number", payload: { unit: typeof unit === "string" ? unit : "" } };
  },
  grade(definition, response, ctx) {
    const base = calculatedBase(definition);
    const dataset = ctx.dataset ?? base.datasets[0];
    let expected: number;
    try {
      expected = evaluateFormula(base.formula, dataset);
    } catch {
      return { fraction: 0, feedback: feedbackOf(undefined, 0, ctx) };
    }
    const actual = parseNumber(isRecord(response) ? response.value : null);
    if (actual === null) return { fraction: 0, feedback: feedbackOf(undefined, 0, ctx) };
    const ok = withinTolerance(actual, expected, base.tolerance, base.toleranceType);
    return { fraction: ok ? 1 : 0, feedback: feedbackOf(undefined, ok ? 1 : 0, ctx) };
  },
  solution(definition, ctx) {
    const base = calculatedBase(definition);
    const dataset = ctx.dataset ?? base.datasets[0];
    try {
      const value = evaluateFormula(base.formula, dataset);
      return { summary: String(roundNice(value)), value };
    } catch {
      return { summary: "" };
    }
  },
};

const calculatedmc: QuestionPlugin = {
  type: "calculatedmc",
  label: { ru: "Вычисляемый выбор", en: "Calculated multichoice" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    formula: "{a}+{b}",
    tolerance: 0.01,
    variables: ["a", "b"],
    datasets: [{ a: 2, b: 3 }],
    choices: [
      { id: "c1", formula: "{a}+{b}" },
      { id: "c2", formula: "{a}*{b}" },
    ],
  }),
  validate(definition) {
    const base = calculatedBase(definition);
    const choices = asRecord(definition).choices;
    if (!Array.isArray(choices) || choices.length < 2) fail("choices_min");
    const ids: string[] = [];
    for (const choice of choices) {
      const row = asRecord(choice);
      ids.push(plainText(row.id, "ids_not_unique"));
      if (typeof row.formula === "string" && row.formula.trim()) {
        try {
          assertFormula(row.formula, base.variables);
        } catch {
          fail("formula_invalid");
        }
      } else if (typeof row.text !== "string") {
        fail("text_required");
      }
    }
    uniqueIds(ids);
  },
  materialize(definition, ctx) {
    const base = calculatedBase(definition);
    const index = Math.floor((ctx.random ?? Math.random)() * base.datasets.length);
    const picked = base.datasets[index];
    const data = asRecord(definition);
    const choices = Array.isArray(data.choices) ? data.choices.slice() : [];
    return {
      definition: { ...data, datasets: [picked], choices: ctx.shuffle ? shuffle(choices, ctx.random) : choices },
      dataset: picked,
    };
  },
  publicView(definition, ctx) {
    const base = calculatedBase(definition);
    const dataset = ctx.dataset ?? base.datasets[0];
    const choices = (asRecord(definition).choices as unknown[]).map((choice) => {
      const row = asRecord(choice);
      let text = typeof row.text === "string" ? row.text : "";
      if (typeof row.formula === "string" && row.formula.trim()) {
        try {
          text = String(roundNice(evaluateFormula(row.formula, dataset)));
        } catch {
          text = "—";
        }
      }
      return { id: String(row.id), text };
    });
    return { widget: "choices", payload: { single: true, choices } };
  },
  grade(definition, response, ctx) {
    const correct = correctCalculatedChoices(definition, ctx.dataset);
    const selected = choiceResponse(response)[0];
    const ok = selected ? correct.has(selected) : false;
    return { fraction: ok ? 1 : 0, feedback: feedbackOf(undefined, ok ? 1 : 0, ctx) };
  },
  solution(definition, ctx) {
    const correct = correctCalculatedChoices(definition, ctx.dataset);
    const view = calculatedmc.publicView(definition, ctx);
    const choices = (view.payload.choices as { id: string; text: string }[]).filter((choice) => correct.has(choice.id));
    return {
      summary: choices.map((choice) => choice.text).join(", "),
      choiceIds: choices.map((choice) => choice.id),
    };
  },
};

function correctCalculatedChoices(definition: unknown, dataset: Record<string, number> | null | undefined): Set<string> {
  const base = calculatedBase(definition);
  const values = dataset ?? base.datasets[0];
  const expected = evaluateFormula(base.formula, values);
  const ids = new Set<string>();
  for (const choice of asRecord(definition).choices as unknown[]) {
    const row = asRecord(choice);
    if (typeof row.formula === "string" && row.formula.trim()) {
      const value = evaluateFormula(row.formula, values);
      if (withinTolerance(value, expected, base.tolerance, base.toleranceType)) ids.add(String(row.id));
    } else if (row.correct === true) {
      ids.add(String(row.id));
    }
  }
  return ids;
}

function assertBox(row: Record<string, unknown>): void {
  for (const key of ["x", "y", "w", "h"]) {
    if (typeof row[key] !== "number" || !Number.isFinite(row[key] as number)) fail("region_invalid");
  }
}

function pointInRegion(point: { x: number; y: number }, region: { shape: string; coords: number[] }): boolean {
  const { coords } = region;
  if (region.shape === "rect" && coords.length >= 4) {
    const [x, y, w, h] = coords;
    return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
  }
  if (region.shape === "circle" && coords.length >= 3) {
    const [cx, cy, r] = coords;
    return (point.x - cx) ** 2 + (point.y - cy) ** 2 <= r ** 2;
  }
  if (region.shape === "poly" && coords.length >= 6) {
    let inside = false;
    for (let i = 0, j = coords.length - 2; i < coords.length; i += 2) {
      const xi = coords[i];
      const yi = coords[i + 1];
      const xj = coords[j];
      const yj = coords[j + 1];
      const hit = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
      j = i;
    }
    return inside;
  }
  return false;
}

const hotspot: QuestionPlugin = {
  type: "hotspot",
  label: { ru: "Горячие точки", en: "Hotspot" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    imageUrl: "https://example.com/map.png",
    multiple: false,
    regions: [{ id: "r1", shape: "rect", coords: [10, 10, 20, 20], fraction: 1 }],
  }),
  validate(definition) {
    const data = asRecord(definition);
    httpUrl(data.imageUrl);
    if (typeof data.multiple !== "boolean") fail("definition_invalid");
    if (!Array.isArray(data.regions) || data.regions.length === 0) fail("region_invalid");
    const ids: string[] = [];
    for (const region of data.regions) {
      const row = asRecord(region);
      ids.push(plainText(row.id, "ids_not_unique"));
      if (row.shape !== "rect" && row.shape !== "circle" && row.shape !== "poly") fail("region_invalid");
      if (!Array.isArray(row.coords) || row.coords.some((coord) => typeof coord !== "number")) fail("region_invalid");
      fraction(row.fraction);
    }
    uniqueIds(ids);
  },
  publicView(definition) {
    const data = asRecord(definition);
    return { widget: "hotspot", payload: { imageUrl: String(data.imageUrl), multiple: Boolean(data.multiple) } };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const regions = (data.regions as unknown[]).map((region) => {
      const row = asRecord(region);
      return { id: String(row.id), shape: String(row.shape), coords: row.coords as number[], fraction: fraction(row.fraction) };
    });
    const points = isRecord(response) && Array.isArray(response.points) ? response.points : [];
    const parsed = points
      .filter(isRecord)
      .map((point) => ({ x: parseNumber(point.x), y: parseNumber(point.y) }))
      .filter((point): point is { x: number; y: number } => point.x !== null && point.y !== null);
    if (!data.multiple) {
      const point = parsed[0];
      if (!point) return { fraction: 0, feedback: feedbackOf(undefined, 0, ctx) };
      let hit = 0;
      for (const region of regions) {
        if (pointInRegion(point, region)) hit = region.fraction;
      }
      const value = clamp01(hit);
      return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
    }
    const seen = new Set<string>();
    let sum = 0;
    for (const point of parsed) {
      for (const region of regions) {
        if (seen.has(region.id)) continue;
        if (pointInRegion(point, region)) {
          seen.add(region.id);
          sum += region.fraction;
        }
      }
    }
    const value = clamp01(sum);
    return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
  },
  solution(definition) {
    const regions = (asRecord(definition).regions as unknown[]).map((region) => {
      const row = asRecord(region);
      return { id: String(row.id), shape: String(row.shape), coords: row.coords as number[], fraction: fraction(row.fraction) };
    });
    const positive = regions.filter((region) => region.fraction > 0);
    return {
      summary: positive.map((region) => region.id).join(", "),
      regions: positive.map(({ id, shape, coords }) => ({ id, shape, coords })),
    };
  },
};

const gapselect: QuestionPlugin = {
  type: "gapselect",
  label: { ru: "Выбор пропущенных слов", en: "Select missing words" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({
    template: "[[1]]",
    choices: [
      { id: "c1", text: "", group: "g1" },
      { id: "c2", text: "", group: "g1" },
    ],
    gaps: [{ id: "1", correctChoiceId: "c1", group: "g1" }],
  }),
  validate(definition) {
    const data = gapselectData(definition);
    for (const gap of data.gaps) {
      if (!data.template.includes(`[[${gap.id}]]`)) fail("gap_missing", { id: gap.id });
      const choice = data.choices.find((item) => item.id === gap.correctChoiceId);
      if (!choice) fail("option_missing");
      if (gap.group && choice.group && gap.group !== choice.group) fail("option_missing");
    }
  },
  materialize(definition, ctx) {
    const data = gapselectData(definition);
    return { definition: { ...data, choices: ctx.shuffle ? shuffle(data.choices, ctx.random) : data.choices } };
  },
  publicView(definition) {
    const data = gapselectData(definition);
    return {
      widget: "gaps",
      presentation: "select",
      payload: {
        template: data.template,
        pool: data.choices.map(({ id, text }) => ({ id, text })),
        gaps: data.gaps.map((gap) => ({
          id: gap.id,
          choiceIds: data.choices.filter((choice) => !gap.group || choice.group === gap.group).map((choice) => choice.id),
        })),
      },
    };
  },
  grade(definition, response, ctx) {
    const data = gapselectData(definition);
    const picks = gapPicks(response);
    let correct = 0;
    for (const gap of data.gaps) {
      if (picks.get(gap.id) === gap.correctChoiceId) correct += 1;
    }
    const value = data.gaps.length ? correct / data.gaps.length : 0;
    return { fraction: value, feedback: feedbackOf(undefined, value, ctx) };
  },
  solution(definition) {
    const data = gapselectData(definition);
    const labels = new Map(data.choices.map((choice) => [choice.id, choice.text]));
    const gaps = data.gaps.map((gap) => ({
      id: gap.id,
      value: gap.correctChoiceId,
      label: labels.get(gap.correctChoiceId) ?? gap.correctChoiceId,
    }));
    return { summary: gaps.map((gap) => gap.label).join(", "), gaps };
  },
};

function gapselectData(definition: unknown) {
  const data = asRecord(definition);
  const template = plainText(data.template);
  if (!Array.isArray(data.choices) || data.choices.length < 2) fail("choices_min");
  if (!Array.isArray(data.gaps) || data.gaps.length === 0) fail("gaps_min");
  const choices = data.choices.map((choice) => {
    const row = asRecord(choice);
    return {
      id: plainText(row.id, "ids_not_unique"),
      text: plainText(row.text),
      group: typeof row.group === "string" ? row.group : undefined,
    };
  });
  uniqueIds(choices.map((choice) => choice.id));
  const gaps = data.gaps.map((gap) => {
    const row = asRecord(gap);
    return {
      id: plainText(row.id, "ids_not_unique"),
      correctChoiceId: plainText(row.correctChoiceId, "option_missing"),
      group: typeof row.group === "string" ? row.group : undefined,
    };
  });
  uniqueIds(gaps.map((gap) => gap.id));
  return { template, choices, gaps };
}

function gapPicks(response: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!isRecord(response) || !Array.isArray(response.gaps)) return map;
  for (const gap of response.gaps) {
    if (!isRecord(gap) || typeof gap.gapId !== "string" && typeof gap.id !== "string") continue;
    const id = typeof gap.gapId === "string" ? gap.gapId : String(gap.id);
    const optionId = typeof gap.optionId === "string" ? gap.optionId : typeof gap.value === "string" ? gap.value : "";
    if (optionId && !map.has(id)) map.set(id, optionId);
  }
  return map;
}

function gapValueMap(response: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!isRecord(response) || !Array.isArray(response.gaps)) return map;
  for (const gap of response.gaps) {
    if (!isRecord(gap)) continue;
    const id = typeof gap.id === "string" ? gap.id : typeof gap.gapId === "string" ? gap.gapId : "";
    if (!id || map.has(id)) continue;
    const value = gap.value ?? gap.optionId;
    map.set(id, value === undefined || value === null ? "" : String(value));
  }
  return map;
}

function roundNice(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

let builtinsReady = false;

export function registerBuiltinQuestionPlugins(): void {
  if (builtinsReady) return;
  builtinsReady = true;
  for (const plugin of [
    multichoice,
    truefalse,
    shortanswer,
    numerical,
    essay,
    matchingPlugin("matching", { ru: "Соответствие", en: "Matching" }, "select"),
    matchingPlugin("ddmatch", { ru: "Перетаскивание на соответствие", en: "Drag-and-drop matching" }, "drag"),
    ddtext,
    ddimage,
    ordering,
    description,
    cloze,
    calculated,
    calculatedmc,
    hotspot,
    gapselect,
  ]) {
    registerQuestionPlugin(plugin);
  }
}

export const SCALE_PLUGIN: QuestionPlugin = {
  type: "scale",
  label: { ru: "Шкала", en: "Scale" },
  manual: false,
  graded: true,
  emptyDefinition: () => ({ min: 1, max: 5, step: 1 }),
  validate(definition) {
    const data = asRecord(definition);
    if (typeof data.min !== "number" || typeof data.max !== "number" || data.max < data.min) fail("range_invalid");
    if (data.step !== undefined && (typeof data.step !== "number" || data.step <= 0)) fail("range_invalid");
    if (data.correct !== undefined && data.correct !== null && typeof data.correct !== "number") fail("definition_invalid");
  },
  publicView(definition) {
    const data = asRecord(definition);
    return {
      widget: "scale",
      payload: {
        min: data.min,
        max: data.max,
        step: typeof data.step === "number" ? data.step : 1,
      },
    };
  },
  grade(definition, response, ctx) {
    const data = asRecord(definition);
    const value = parseNumber(isRecord(response) ? response.value : null);
    const min = data.min as number;
    const max = data.max as number;
    if (value === null || value < min || value > max) return { fraction: 0, feedback: feedbackOf(undefined, 0, ctx) };
    if (typeof data.correct === "number") {
      const ok = value === data.correct;
      return { fraction: ok ? 1 : 0, feedback: feedbackOf(undefined, ok ? 1 : 0, ctx) };
    }
    return { fraction: 1, feedback: feedbackOf(undefined, 1, ctx) };
  },
  solution(definition, ctx) {
    const correct = asRecord(definition).correct;
    if (typeof correct !== "number") {
      return { summary: localeOf(ctx.locale) === "en" ? "Any value on the scale is accepted." : "Засчитывается любой ответ на шкале." };
    }
    return { summary: String(correct), value: correct };
  },
};
