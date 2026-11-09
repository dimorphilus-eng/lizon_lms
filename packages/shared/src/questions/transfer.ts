import { XMLParser } from "fast-xml-parser";
import { QuestionValidationError, type ExportQuestion, type ImportedQuestion } from "./types";
import { getQuestionPlugin, validateDefinition } from "./engine";

export interface TransferResult {
  questions: ImportedQuestion[];
  warnings: string[];
}

export function exportQuestions(questions: ExportQuestion[], format: "json" | "moodle-xml"): string {
  if (format === "json") {
    return JSON.stringify({ format: "lizon-questions-v1", questions }, null, 2);
  }
  const body = questions.map(toMoodleQuestion).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n${body}\n</quiz>\n`;
}

export function importQuestions(payload: string, format?: "json" | "moodle-xml"): TransferResult {
  const detected = format ?? detectFormat(payload);
  if (detected === "json") return importJson(payload);
  return importMoodle(payload);
}

function detectFormat(payload: string): "json" | "moodle-xml" {
  const trimmed = payload.trim();
  if (trimmed.startsWith("<")) return "moodle-xml";
  return "json";
}

function importJson(payload: string): TransferResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new QuestionValidationError("definition_invalid");
  }
  const questions = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.questions)
      ? parsed.questions
      : null;
  if (!questions) throw new QuestionValidationError("definition_invalid");
  const warnings: string[] = [];
  const imported: ImportedQuestion[] = [];
  questions.forEach((item, index) => {
    try {
      imported.push(normalizeImported(item));
    } catch (error) {
      warnings.push(`#${index + 1}: ${error instanceof Error ? error.message : "invalid"}`);
    }
  });
  return { questions: imported, warnings };
}

function normalizeImported(item: unknown): ImportedQuestion {
  if (!isRecord(item) || typeof item.type !== "string") throw new QuestionValidationError("unknown_type");
  getQuestionPlugin(item.type);
  const definition = item.definition ?? {};
  validateDefinition(item.type, definition);
  return {
    type: item.type,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Question",
    text: typeof item.text === "string" ? item.text : "",
    defaultMark: typeof item.defaultMark === "number" ? item.defaultMark : 1,
    penalty: typeof item.penalty === "number" ? item.penalty : 0,
    generalFeedback: typeof item.generalFeedback === "string" ? item.generalFeedback : "",
    definition,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}

function importMoodle(payload: string): TransferResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    cdataPropName: "#cdata",
    isArray: (name) => ["question", "answer", "subquestion", "dataset_definition", "dataset_item"].includes(name),
  });
  const doc = parser.parse(payload) as Record<string, unknown>;
  const quiz = isRecord(doc.quiz) ? doc.quiz : doc;
  const questions = Array.isArray(quiz.question) ? quiz.question : [];
  const warnings: string[] = [];
  const imported: ImportedQuestion[] = [];
  questions.forEach((node, index) => {
    if (!isRecord(node)) return;
    const type = String(node["@_type"] ?? "");
    if (type === "category") return;
    try {
      const question = moodleToQuestion(type, node);
      if (!question) {
        warnings.push(`#${index + 1}: skipped ${type || "unknown"}`);
        return;
      }
      validateDefinition(question.type, question.definition);
      imported.push(question);
    } catch (error) {
      warnings.push(`#${index + 1}: ${error instanceof Error ? error.message : "invalid"}`);
    }
  });
  return { questions: imported, warnings };
}

function moodleToQuestion(type: string, node: Record<string, unknown>): ImportedQuestion | null {
  const name = textOf(node.name) || "Question";
  const text = textOf(node.questiontext);
  const generalFeedback = textOf(node.generalfeedback);
  const defaultMark = numberOf(node.defaultgrade, 1);
  const penalty = numberOf(node.penalty, 0);
  const base = { name, text, defaultMark, penalty, generalFeedback, tags: [] as string[] };

  if (type === "multichoice") {
    const answers = arrayOf(node.answer).map((answer, index) => ({
      id: `a${index + 1}`,
      text: textOf(answer),
      fraction: numberOf(isRecord(answer) ? answer["@_fraction"] : 0, 0) / 100,
      feedback: textOf(isRecord(answer) ? answer.feedback : ""),
    }));
    const single = String(node.single ?? "true") !== "false";
    return { ...base, type: "multichoice", definition: { single, choices: answers } };
  }
  if (type === "truefalse") {
    const answers = arrayOf(node.answer);
    const correct = answers.find((answer) => numberOf(isRecord(answer) ? answer["@_fraction"] : 0, 0) > 0);
    const correctText = textOf(correct).trim().toLowerCase();
    return { ...base, type: "truefalse", definition: { correct: correctText === "true" } };
  }
  if (type === "shortanswer") {
    const caseSensitive = String(node.usecase ?? "0") === "1";
    const answers = arrayOf(node.answer).map((answer) => ({
      text: textOf(answer),
      fraction: numberOf(isRecord(answer) ? answer["@_fraction"] : 0, 0) / 100,
      feedback: textOf(isRecord(answer) ? answer.feedback : ""),
    }));
    return { ...base, type: "shortanswer", definition: { caseSensitive, answers } };
  }
  if (type === "numerical") {
    const answers = arrayOf(node.answer).map((answer) => ({
      value: numberOf(textOf(answer), 0),
      tolerance: numberOf(isRecord(answer) ? answer.tolerance : 0, 0),
      toleranceType: "absolute" as const,
      fraction: numberOf(isRecord(answer) ? answer["@_fraction"] : 0, 0) / 100,
      feedback: textOf(isRecord(answer) ? answer.feedback : ""),
    }));
    return { ...base, type: "numerical", definition: { answers } };
  }
  if (type === "essay") {
    return { ...base, type: "essay", definition: { minWords: 0, maxWords: null } };
  }
  if (type === "matching") {
    const pairs: { id: string; stem: string; answer: string }[] = [];
    const distractors: string[] = [];
    arrayOf(node.subquestion).forEach((sub, index) => {
      const stem = textOf(sub).trim();
      const answer = textOf(isRecord(sub) ? sub.answer : "");
      if (!stem) {
        if (answer) distractors.push(answer);
        return;
      }
      pairs.push({ id: `p${index + 1}`, stem, answer });
    });
    return { ...base, type: "matching", definition: { pairs, distractors } };
  }
  if (type === "description") {
    return { ...base, type: "description", definition: { text } };
  }
  if (type === "cloze") {
    const parsed = parseMoodleCloze(text);
    return { ...base, type: "cloze", text: parsed.template, definition: parsed };
  }
  if (type === "calculated" || type === "calculatedmulti" || type === "calculatedsimple") {
    return calculatedFromMoodle(type, node, base);
  }
  return null;
}

function calculatedFromMoodle(
  type: string,
  node: Record<string, unknown>,
  base: Omit<ImportedQuestion, "type" | "definition">,
): ImportedQuestion | null {
  const answers = arrayOf(node.answer);
  const first = answers[0];
  const formula = textOf(first);
  const tolerance = numberOf(isRecord(first) ? first.tolerance : 0, 0);
  const toleranceType = String(isRecord(first) ? first.tolerancetype ?? first.toleranceType ?? "1" : "1") === "2" ? "relative" : "absolute";
  const definitions = arrayOf(isRecord(node.dataset_definitions) ? node.dataset_definitions.dataset_definition : []);
  const columns: { name: string; values: number[] }[] = definitions.map((definition) => ({
    name: textOf(isRecord(definition) ? definition.name : ""),
    values: arrayOf(isRecord(definition) ? definition.dataset_item ?? nestedItems(definition) : []).map((item) =>
      numberOf(isRecord(item) ? item.number ?? item.value ?? textOf(item) : item, 0),
    ),
  })).filter((column) => column.name);
  const length = Math.max(1, ...columns.map((column) => column.values.length));
  const variables = columns.map((column) => column.name);
  const datasets = Array.from({ length }, (_, index) => {
    const row: Record<string, number> = {};
    for (const column of columns) row[column.name] = column.values[index] ?? column.values[0] ?? 0;
    return row;
  });
  if (type === "calculatedmulti") {
    return {
      ...base,
      type: "calculatedmc",
      definition: {
        formula,
        tolerance,
        toleranceType,
        variables,
        datasets,
        choices: answers.map((answer, index) => ({ id: `c${index + 1}`, formula: textOf(answer) })),
      },
    };
  }
  return {
    ...base,
    type: "calculated",
    definition: { formula, tolerance, toleranceType, variables, datasets, unit: "" },
  };
}

function nestedItems(definition: Record<string, unknown>): unknown[] {
  const items = definition.dataset_items;
  if (isRecord(items) && Array.isArray(items.dataset_item)) return items.dataset_item;
  return [];
}

export function parseMoodleCloze(text: string): { template: string; gaps: unknown[] } {
  const gaps: unknown[] = [];
  let template = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      template += text[i];
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    let weightRaw = "";
    while (i < text.length && /[0-9.]/.test(text[i])) {
      weightRaw += text[i];
      i += 1;
    }
    if (text[i] !== ":") {
      template += text.slice(start, i);
      continue;
    }
    i += 1;
    let kind = "";
    while (i < text.length && text[i] !== ":") {
      kind += text[i];
      i += 1;
    }
    if (text[i] !== ":") {
      template += text.slice(start, i);
      continue;
    }
    i += 1;
    let body = "";
    while (i < text.length && text[i] !== "}") {
      // \} заканчивает не пропуск, а литерал. Остальные экранирования разбирает splitTilde.
      if (text[i] === "\\" && text[i + 1] === "}") {
        body += "}";
        i += 2;
        continue;
      }
      body += text[i];
      i += 1;
    }
    if (text[i] === "}") i += 1;
    const id = `g${gaps.length + 1}`;
    const weight = weightRaw ? Number(weightRaw) || 1 : 1;
    gaps.push(clozeGapFromBody(id, kind.toUpperCase(), body, weight));
    template += `[[${id}]]`;
  }
  if (gaps.length === 0) throw new QuestionValidationError("gaps_min");
  return { template, gaps };
}

function clozeGapFromBody(id: string, kind: string, body: string, weight: number): unknown {
  const parts = splitTilde(body).map(parseClozePart);
  if (kind.startsWith("NUMERICAL")) {
    return {
      id,
      type: "numerical",
      weight,
      answers: parts.map((part) => {
        const [rawValue, rawTolerance] = part.text.split(":");
        return {
          value: Number(rawValue),
          tolerance: rawTolerance ? Number(rawTolerance) : 0,
          toleranceType: "absolute",
          fraction: part.fraction,
        };
      }),
    };
  }
  if (kind.startsWith("MULTICHOICE") || kind.startsWith("MR") || kind.startsWith("MULTIRESPONSE")) {
    return {
      id,
      type: "multichoice",
      weight,
      choices: parts.map((part, index) => ({
        id: `${id}c${index + 1}`,
        text: part.text,
        fraction: part.fraction,
      })),
    };
  }
  return {
    id,
    type: "shortanswer",
    weight,
    caseSensitive: kind.includes("_C"),
    answers: parts.map((part) => ({ text: part.text, fraction: part.fraction })),
  };
}

function parseClozePart(part: string): { fraction: number; text: string } {
  let source = part.trim();
  let grade = 0;
  if (source.startsWith("=")) {
    grade = 1;
    source = source.slice(1);
  } else {
    const match = source.match(/^%(-?\d+(?:\.\d+)?)%/);
    if (match) {
      grade = Number(match[1]) / 100;
      source = source.slice(match[0].length);
    }
  }
  const feedbackAt = source.indexOf("#");
  if (feedbackAt >= 0) source = source.slice(0, feedbackAt);
  return { fraction: grade, text: source.trim() };
}

function splitTilde(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && i + 1 < body.length) {
      current += body[i + 1];
      i += 1;
      continue;
    }
    if (body[i] === "~") {
      parts.push(current);
      current = "";
      continue;
    }
    current += body[i];
  }
  parts.push(current);
  return parts.filter((part) => part.trim() !== "");
}

function toMoodleQuestion(question: ExportQuestion): string {
  const common = [
    `<question type="${escapeAttr(moodleType(question.type))}">`,
    `<name><text>${escapeText(question.name)}</text></name>`,
    `<questiontext format="html"><text>${cdata(moodlePrompt(question))}</text></questiontext>`,
    `<generalfeedback><text>${escapeText(question.generalFeedback)}</text></generalfeedback>`,
    `<defaultgrade>${question.defaultMark}</defaultgrade>`,
    `<penalty>${question.penalty}</penalty>`,
  ];
  common.push(...moodleBody(question));
  common.push("</question>");
  return common.join("");
}

function moodleType(type: string): string {
  if (type === "calculatedmc") return "calculatedmulti";
  return type;
}

function moodlePrompt(question: ExportQuestion): string {
  if (question.type !== "cloze" || !isRecord(question.definition)) return question.text;
  const template = String(question.definition.template ?? question.text);
  const gaps = Array.isArray(question.definition.gaps) ? question.definition.gaps : [];
  return gaps.reduce<string>((text, gap, index) => {
    if (!isRecord(gap)) return text;
    const id = String(gap.id ?? "");
    return text.replaceAll(`[[${id}]]`, clozeToken(gap, index));
  }, template);
}

function clozeToken(gap: Record<string, unknown>, index: number): string {
  const weight = typeof gap.weight === "number" ? gap.weight : 1;
  if (gap.type === "numerical" && Array.isArray(gap.answers)) {
    const parts = gap.answers.map((answer) => {
      if (!isRecord(answer)) return "";
      const prefix = fractionPrefix(numberOf(answer.fraction, 0));
      return `${prefix}${answer.value}:${answer.tolerance ?? 0}`;
    });
    return `{${weight}:NUMERICAL:${parts.join("~")}}`;
  }
  if (gap.type === "multichoice" && Array.isArray(gap.choices)) {
    const parts = gap.choices.map((choice) => {
      if (!isRecord(choice)) return "";
      return `${fractionPrefix(numberOf(choice.fraction, 0))}${choice.text}`;
    });
    return `{${weight}:MULTICHOICE:${parts.join("~")}}`;
  }
  const sensitive = gap.caseSensitive ? "SHORTANSWER_C" : "SHORTANSWER";
  const answers = Array.isArray(gap.answers) ? gap.answers : [];
  const parts = answers.map((answer) => {
    if (!isRecord(answer)) return "";
    return `${fractionPrefix(numberOf(answer.fraction, 0))}${answer.text}`;
  });
  return `{${weight}:${sensitive}:${parts.join("~")}}`;
  void index;
}

function fractionPrefix(value: number): string {
  if (value >= 0.999) return "=";
  if (value === 0) return "";
  return `%${Math.round(value * 100)}%`;
}

function moodleBody(question: ExportQuestion): string[] {
  const definition = isRecord(question.definition) ? question.definition : {};
  if (question.type === "multichoice") {
    const lines = [`<single>${definition.single === false ? "false" : "true"}</single>`, "<shuffleanswers>1</shuffleanswers>"];
    for (const choice of arrayOf(definition.choices)) {
      if (!isRecord(choice)) continue;
      lines.push(
        `<answer fraction="${Math.round(numberOf(choice.fraction, 0) * 100)}"><text>${escapeText(String(choice.text ?? ""))}</text><feedback><text>${escapeText(String(choice.feedback ?? ""))}</text></feedback></answer>`,
      );
    }
    return lines;
  }
  if (question.type === "truefalse") {
    const correct = definition.correct === true;
    return [
      `<answer fraction="${correct ? 100 : 0}"><text>true</text></answer>`,
      `<answer fraction="${correct ? 0 : 100}"><text>false</text></answer>`,
    ];
  }
  if (question.type === "shortanswer") {
    const lines = [`<usecase>${definition.caseSensitive ? 1 : 0}</usecase>`];
    for (const answer of arrayOf(definition.answers)) {
      if (!isRecord(answer)) continue;
      lines.push(
        `<answer fraction="${Math.round(numberOf(answer.fraction, 0) * 100)}"><text>${escapeText(String(answer.text ?? ""))}</text><feedback><text>${escapeText(String(answer.feedback ?? ""))}</text></feedback></answer>`,
      );
    }
    return lines;
  }
  if (question.type === "numerical" || question.type === "calculated") {
    const answers = question.type === "calculated"
      ? [{ text: definition.formula, fraction: 1, tolerance: definition.tolerance }]
      : arrayOf(definition.answers);
    const lines = answers.map((answer) => {
      if (!isRecord(answer) && question.type !== "calculated") return "";
      const row = isRecord(answer) ? answer : {};
      const text = question.type === "calculated" ? String(definition.formula ?? "") : String(row.text ?? row.value ?? "");
      const tolerance = question.type === "calculated" ? numberOf(definition.tolerance, 0) : numberOf(row.tolerance, 0);
      const fraction = question.type === "calculated" ? 100 : Math.round(numberOf(row.fraction, 0) * 100);
      return `<answer fraction="${fraction}"><text>${escapeText(text)}</text><tolerance>${tolerance}</tolerance><tolerancetype>${definition.toleranceType === "relative" || row.toleranceType === "relative" ? 2 : 1}</tolerancetype></answer>`;
    });
    if (question.type === "calculated") lines.push(datasetXml(definition));
    return lines;
  }
  if (question.type === "matching") {
    const lines: string[] = [];
    for (const pair of arrayOf(definition.pairs)) {
      if (!isRecord(pair)) continue;
      lines.push(`<subquestion><text>${escapeText(String(pair.stem ?? ""))}</text><answer><text>${escapeText(String(pair.answer ?? ""))}</text></answer></subquestion>`);
    }
    for (const distractor of arrayOf(definition.distractors)) {
      lines.push(`<subquestion><text></text><answer><text>${escapeText(String(distractor))}</text></answer></subquestion>`);
    }
    return lines;
  }
  if (question.type === "essay") return ["<responseformat>editor</responseformat>"];
  if (question.type === "calculatedmc") {
    const lines: string[] = [];
    for (const choice of arrayOf(definition.choices)) {
      if (!isRecord(choice)) continue;
      lines.push(`<answer fraction="100"><text>${escapeText(String(choice.formula ?? choice.text ?? ""))}</text><tolerance>${numberOf(definition.tolerance, 0)}</tolerance></answer>`);
    }
    lines.push(datasetXml(definition));
    return lines;
  }
  return [];
}

function datasetXml(definition: Record<string, unknown>): string {
  const variables = Array.isArray(definition.variables) ? definition.variables.map(String) : [];
  const datasets = Array.isArray(definition.datasets) ? definition.datasets : [];
  const definitions = variables.map((name) => {
    const items = datasets.map((dataset, index) => {
      const value = isRecord(dataset) ? dataset[name] : 0;
      return `<dataset_item><number>${value}</number><itemnumber>${index}</itemnumber></dataset_item>`;
    });
    return `<dataset_definition><name><text>${escapeText(name)}</text></name><dataset_items>${items.join("")}</dataset_items></dataset_definition>`;
  });
  return `<dataset_definitions>${definitions.join("")}</dataset_definitions>`;
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (!isRecord(node)) return "";
  if (typeof node["#cdata"] === "string") return node["#cdata"];
  if (typeof node["#text"] === "string" || typeof node["#text"] === "number") return String(node["#text"]);
  if ("text" in node) return textOf(node.text);
  return "";
}

function arrayOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function numberOf(value: unknown, fallback: number): number {
  if (isRecord(value)) {
    if ("#text" in value) return numberOf(value["#text"], fallback);
    if ("#cdata" in value) return numberOf(value["#cdata"], fallback);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}
