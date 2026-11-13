import { describe, expect, it } from "vitest";
import { evaluateAccess } from "../src/access";
import { FormulaError, evaluateFormula } from "../src/formula";
import { videoEmbed } from "../src/media";
import {
  SCALE_PLUGIN,
  exportQuestions,
  gradeQuestion,
  importQuestions,
  listQuestionTypes,
  materializeQuestion,
  presentQuestion,
  registerQuestionPlugin,
  solveQuestion,
  validateDefinition,
} from "../src/index";
import { wildcardMatch } from "../src/wildcard";

const grade = (type: string, definition: unknown, response: unknown, extra: Record<string, unknown> = {}) =>
  gradeQuestion({ type, definition, response, maxScore: 2, ...extra });

describe("formula", () => {
  it("respects precedence and moodle braces", () => {
    expect(evaluateFormula("2+3*4", {})).toBe(14);
    expect(evaluateFormula("{a}+{b}", { a: 2, b: 3 })).toBe(5);
    expect(evaluateFormula("2^3^2", {})).toBe(512);
    expect(evaluateFormula("abs(-3)+sqrt(9)+min(2,5)", {})).toBe(8);
  });

  it("rejects code execution", () => {
    expect(() => evaluateFormula("process.exit(1)", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("constructor", {})).toThrow(FormulaError);
  });
});

describe("wildcard", () => {
  it("matches moodle patterns", () => {
    expect(wildcardMatch("Paris", "paris", false)).toBe(true);
    expect(wildcardMatch("Paris", "paris", true)).toBe(false);
    expect(wildcardMatch("*ton", "newton", false)).toBe(true);
    expect(wildcardMatch("a?c", "abc", false)).toBe(true);
    expect(wildcardMatch("a?c", "ac", false)).toBe(false);
  });
});

describe("question types", () => {
  it("registers the moodle-like catalogue", () => {
    const types = listQuestionTypes().map((item) => item.type);
    expect(types).toEqual([
      "multichoice",
      "truefalse",
      "shortanswer",
      "numerical",
      "essay",
      "matching",
      "ddmatch",
      "ddtext",
      "ddimage",
      "ordering",
      "description",
      "cloze",
      "calculated",
      "calculatedmc",
      "hotspot",
      "gapselect",
    ]);
  });

  it("grades single and multiple choice, including negative weights", () => {
    const single = grade("multichoice", {
      single: true,
      choices: [
        { id: "a", text: "Paris", fraction: 1 },
        { id: "b", text: "Lyon", fraction: 0 },
      ],
    }, { choiceIds: ["a"] });
    expect(single.fraction).toBe(1);
    expect(single.score).toBe(2);

    const multi = grade("multichoice", {
      single: false,
      choices: [
        { id: "a", text: "A", fraction: 0.5 },
        { id: "b", text: "B", fraction: 0.5 },
        { id: "c", text: "C", fraction: -0.5 },
      ],
    }, { choiceIds: ["a", "c"] });
    expect(multi.fraction).toBe(0);

    const partial = grade("multichoice", {
      single: false,
      choices: [
        { id: "a", text: "A", fraction: 0.5 },
        { id: "b", text: "B", fraction: 0.5 },
      ],
    }, { choiceIds: ["a"] });
    expect(partial.fraction).toBe(0.5);
  });

  it("does not leak choice grades into the public payload", () => {
    const view = presentQuestion({
      type: "multichoice",
      prompt: "Capital?",
      definition: {
        single: true,
        choices: [
          { id: "a", text: "Paris", fraction: 1, feedback: "yes" },
          { id: "b", text: "Lyon", fraction: 0 },
        ],
      },
    });
    expect(JSON.stringify(view)).not.toContain("fraction");
    expect(JSON.stringify(view)).not.toContain("yes");
  });

  it("grades true/false, short answer, numerical and essay", () => {
    expect(grade("truefalse", { correct: true }, { value: false }).fraction).toBe(0);
    expect(grade("shortanswer", {
      caseSensitive: false,
      answers: [{ text: "par*", fraction: 1 }, { text: "city", fraction: 0.5 }],
    }, { text: "Paris" }).fraction).toBe(1);
    expect(grade("numerical", {
      answers: [{ value: 3.14, tolerance: 0.01, toleranceType: "absolute", fraction: 1 }],
    }, { value: "3,145" }).fraction).toBe(1);
    expect(grade("numerical", {
      answers: [{ value: 100, tolerance: 0.1, toleranceType: "relative", fraction: 1 }],
    }, { value: 109 }).fraction).toBe(1);
    const essay = grade("essay", { minWords: 2 }, { text: "one" });
    expect(essay.needsManual).toBe(true);
    expect(grade("essay", {}, { text: "   " }).needsManual).toBe(false);
  });

  it("grades matching with opaque ids and partial credit", () => {
    const authored = {
      pairs: [
        { id: "fr", stem: "France", answer: "Paris" },
        { id: "it", stem: "Italy", answer: "Rome" },
      ],
      distractors: ["Lyon"],
    };
    const materialized = materializeQuestion("matching", authored, { shuffle: false });
    const view = presentQuestion({ type: "matching", prompt: "Match", definition: materialized.definition });
    expect(JSON.stringify(view)).not.toContain("correctStemId");
    const payload = view.payload as { options: { id: string }[] };
    expect(payload.options.map((option) => option.id)).toEqual(["opt_1", "opt_2", "opt_3"]);
    const result = grade("matching", materialized.definition, {
      pairs: [
        { stemId: "fr", optionId: "opt_1" },
        { stemId: "it", optionId: "opt_3" },
      ],
    });
    expect(result.fraction).toBe(0.5);
  });

  it("grades drag-and-drop, ordering, cloze, gaps and hotspots", () => {
    expect(grade("ddtext", {
      template: "The [[1]] is [[2]].",
      gaps: [
        { id: "1", correctOptionId: "a" },
        { id: "2", correctOptionId: "b" },
      ],
      options: [
        { id: "a", text: "sky" },
        { id: "b", text: "blue" },
      ],
    }, { gaps: [{ gapId: "1", optionId: "a" }, { gapId: "2", optionId: "a" }] }).fraction).toBe(0.5);

    expect(grade("ddimage", {
      imageUrl: "https://example.com/a.png",
      drops: [{ id: "z1", x: 0, y: 0, w: 10, h: 10 }],
      drags: [{ id: "d1", text: "Heart", correctDropId: "z1" }],
    }, { placements: [{ dragId: "d1", dropId: "z1" }] }).fraction).toBe(1);

    const ordered = materializeQuestion("ordering", {
      items: [
        { id: "a", text: "First" },
        { id: "b", text: "Second" },
        { id: "c", text: "Third" },
      ],
    }, { shuffle: true, random: () => 0 });
    const orderView = presentQuestion({ type: "ordering", prompt: "Order", definition: ordered.definition });
    expect((orderView.payload.items as { id: string }[]).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(grade("ordering", ordered.definition, { order: ["a", "b", "c"] }).fraction).toBe(1);

    expect(grade("cloze", {
      template: "[[city]] [[n]]",
      gaps: [
        { id: "city", type: "shortanswer", weight: 1, caseSensitive: false, answers: [{ text: "Paris", fraction: 1 }] },
        { id: "n", type: "numerical", weight: 1, answers: [{ value: 10, tolerance: 0, toleranceType: "absolute", fraction: 1 }] },
      ],
    }, { gaps: [{ id: "city", value: "paris" }, { id: "n", value: "10" }] }).fraction).toBe(1);

    expect(grade("gapselect", {
      template: "[[1]]",
      choices: [
        { id: "c1", text: "Earth", group: "a" },
        { id: "c2", text: "Mars", group: "a" },
      ],
      gaps: [{ id: "1", correctChoiceId: "c1", group: "a" }],
    }, { gaps: [{ gapId: "1", optionId: "c1" }] }).fraction).toBe(1);

    expect(grade("hotspot", {
      imageUrl: "https://example.com/a.png",
      multiple: false,
      regions: [
        { id: "r1", shape: "rect", coords: [10, 10, 20, 20], fraction: 1 },
        { id: "r2", shape: "circle", coords: [70, 70, 5], fraction: 0.5 },
      ],
    }, { points: [{ x: 15, y: 15 }] }).fraction).toBe(1);

    expect(grade("hotspot", {
      imageUrl: "https://example.com/a.png",
      multiple: false,
      regions: [{ id: "p", shape: "poly", coords: [0, 0, 10, 0, 10, 10], fraction: 1 }],
    }, { points: [{ x: 8, y: 2 }] }).fraction).toBe(1);
  });

  it("grades calculated questions from a frozen dataset", () => {
    const materialized = materializeQuestion("calculated", {
      formula: "{a}+{b}",
      tolerance: 0,
      toleranceType: "absolute",
      variables: ["a", "b"],
      datasets: [{ a: 2, b: 3 }, { a: 10, b: 1 }],
      unit: "",
    }, { shuffle: false, random: () => 0 });
    expect(materialized.dataset).toEqual({ a: 2, b: 3 });
    const view = presentQuestion({
      type: "calculated",
      prompt: "Compute",
      definition: materialized.definition,
      dataset: materialized.dataset,
    });
    expect(JSON.stringify(view)).not.toContain("{a}");
    expect(JSON.stringify(materialized.definition)).not.toContain('"a":10');
    expect(grade("calculated", materialized.definition, { value: 5 }, { dataset: materialized.dataset }).fraction).toBe(1);

    const multi = materializeQuestion("calculatedmc", {
      formula: "{a}*{b}",
      tolerance: 0.001,
      variables: ["a", "b"],
      datasets: [{ a: 4, b: 5 }],
      choices: [
        { id: "c1", formula: "{a}*{b}" },
        { id: "c2", formula: "{a}+{b}" },
      ],
    }, { shuffle: false, random: () => 0 });
    const shown = presentQuestion({ type: "calculatedmc", prompt: "Pick", definition: multi.definition, dataset: multi.dataset });
    expect(JSON.stringify(shown)).not.toContain("{a}");
    expect(grade("calculatedmc", multi.definition, { choiceIds: ["c1"] }, { dataset: multi.dataset }).fraction).toBe(1);
    expect(solveQuestion({ type: "calculatedmc", definition: multi.definition, dataset: multi.dataset }).summary).toContain("20");
  });

  it("applies adaptive penalties and ignores them in deferred mode", () => {
    const wrong = grade("truefalse", { correct: true }, { value: false }, {
      mode: "adaptive",
      penalty: 0.5,
      wrongTries: 0,
      finalized: false,
    });
    expect(wrong.wrongTries).toBe(1);
    expect(wrong.fraction).toBe(0);
    const recovered = grade("truefalse", { correct: true }, { value: true }, {
      mode: "adaptive",
      penalty: 0.5,
      wrongTries: 1,
      finalized: false,
    });
    expect(recovered.fraction).toBe(0.5);
    expect(recovered.locked).toBe(true);
    const deferred = grade("truefalse", { correct: false }, { value: false }, { mode: "deferred", penalty: 0.5, wrongTries: 3 });
    expect(deferred.fraction).toBe(1);
  });

  it("gives description questions no score", () => {
    const result = grade("description", { text: "Read" }, {});
    expect(result.maxScore).toBe(0);
    expect(result.score).toBe(0);
  });

  it("validates broken definitions", () => {
    expect(() => validateDefinition("multichoice", { single: true, choices: [] })).toThrow(/choices_min/);
    expect(() => validateDefinition("calculated", {
      formula: "alert(1)",
      tolerance: 0,
      variables: [],
      datasets: [{}],
    })).toThrow();
  });

  it("accepts an external scale plugin", () => {
    registerQuestionPlugin(SCALE_PLUGIN);
    expect(grade("scale", { min: 1, max: 5, step: 1, correct: 4 }, { value: 4 }).fraction).toBe(1);
    expect(grade("scale", { min: 1, max: 5 }, { value: 2 }).fraction).toBe(1);
    expect(listQuestionTypes().some((item) => item.type === "scale")).toBe(true);
  });
});

describe("import and export", () => {
  const questions = [
    {
      type: "multichoice",
      name: "Capital",
      text: "Capital of France?",
      defaultMark: 1,
      penalty: 0.333,
      generalFeedback: "",
      tags: ["geo"],
      definition: {
        single: true,
        choices: [
          { id: "a", text: "Paris", fraction: 1, feedback: "yes" },
          { id: "b", text: "Lyon", fraction: 0, feedback: "" },
        ],
      },
    },
    {
      type: "cloze",
      name: "Cloze",
      text: "[[g1]]",
      defaultMark: 1,
      penalty: 0,
      generalFeedback: "",
      tags: [],
      definition: {
        template: "City [[g1]]",
        gaps: [{ id: "g1", type: "shortanswer", weight: 1, caseSensitive: false, answers: [{ text: "Paris", fraction: 1 }, { text: "Lutetia", fraction: 0.5 }] }],
      },
    },
    {
      type: "calculated",
      name: "Sum",
      text: "Sum {a} and {b}",
      defaultMark: 1,
      penalty: 0,
      generalFeedback: "",
      tags: [],
      definition: {
        formula: "{a}+{b}",
        tolerance: 0.1,
        toleranceType: "absolute",
        variables: ["a", "b"],
        datasets: [{ a: 2, b: 3 }],
        unit: "",
      },
    },
  ];

  it("roundtrips json and moodle xml", () => {
    const json = importQuestions(exportQuestions(questions, "json"));
    expect(json.questions).toHaveLength(3);
    expect(json.questions[0].definition).toMatchObject({ single: true });

    const xml = exportQuestions(questions, "moodle-xml");
    const imported = importQuestions(xml, "moodle-xml");
    expect(imported.warnings).toEqual([]);
    expect(imported.questions.map((question) => question.type)).toEqual(["multichoice", "cloze", "calculated"]);
    expect(imported.questions[1].definition).toMatchObject({
      template: "City [[g1]]",
    });
    const clozeGap = (imported.questions[1].definition as { gaps: { answers: { fraction: number }[] }[] }).gaps[0];
    expect(clozeGap.answers.map((answer) => answer.fraction)).toEqual([1, 0.5]);
    expect(grade("calculated", imported.questions[2].definition, { value: 5 }, { dataset: { a: 2, b: 3 } }).fraction).toBe(1);
  });

  it("imports a handwritten moodle question and skips unknown types", () => {
    const xml = `<?xml version="1.0"?>
      <quiz>
        <question type="category"><category><text>$course$/top</text></category></question>
        <question type="truefalse">
          <name><text>Median</text></name>
          <questiontext format="html"><text><![CDATA[<p>Median resists outliers.</p>]]></text></questiontext>
          <defaultgrade>1</defaultgrade>
          <answer fraction="100"><text>true</text></answer>
          <answer fraction="0"><text>false</text></answer>
        </question>
        <question type="ddwtos"><name><text>x</text></name></question>
      </quiz>`;
    const result = importQuestions(xml);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].type).toBe("truefalse");
    expect(result.warnings[0]).toContain("ddwtos");
    expect(grade("truefalse", result.questions[0].definition, { value: true }).fraction).toBe(1);
  });
});

describe("access and media", () => {
  it("evaluates combined availability rules", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const open = evaluateAccess({
      type: "all",
      conditions: [
        { type: "date", from: "2026-11-01T00:00:00Z", until: "2026-12-01T00:00:00Z" },
        { type: "completion", activityId: "lesson-1" },
        { type: "grade", activityId: "quiz-1", minFraction: 0.6 },
        { type: "group", groupIds: ["g-a"] },
      ],
    }, {
      now,
      completedActivityIds: ["lesson-1"],
      grades: { "quiz-1": 0.8 },
      groupIds: ["g-a"],
    });
    expect(open.open).toBe(true);
    const closed = evaluateAccess({ type: "any", conditions: [{ type: "group", groupIds: ["other"] }] }, {
      now,
      completedActivityIds: [],
      grades: {},
      groupIds: ["g-a"],
    });
    expect(closed).toEqual({ open: false, reason: "requires_group" });
  });

  it("allows only known video embeds", () => {
    expect(videoEmbed("https://www.youtube.com/watch?v=abcdefghijk")?.kind).toBe("youtube");
    expect(videoEmbed("https://vimeo.com/12345")?.src).toContain("12345");
    expect(videoEmbed("https://evil.example/embed.html")).toBeNull();
    expect(videoEmbed("https://cdn.example/lesson.mp4")?.kind).toBe("file");
  });
});
