import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../dist/app.module";
import { configureApp } from "../dist/main";

const header = { "x-requested-with": "lizon" };

describe("learning flow", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: ["error"] });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lets a student pass the quiz and a teacher finish the grade", async () => {
    const server = app.getHttpServer();
    const health = await request(server).get("/api/health");
    if (health.status !== 200) console.log("health", health.status, health.body);
    expect(health.status).toBe(200);

    const student = request.agent(server);
    await student.post("/api/auth/login").set(header).send({ email: "student@lizon.test", password: "LizonDemo!2026" }).expect(201);
    const outline = await student.get("/api/courses?scope=mine").set(header).expect(200);
    const course = outline.body.find((item: { slug: string }) => item.slug === "data-literacy");
    expect(course).toBeTruthy();
    const map = await student.get(`/api/courses/${course.id}/outline`).set(header).expect(200);
    const quizActivity = map.body.modules.flatMap((module: { activities: { title: string; id: string; locked: boolean }[] }) => module.activities).find((item: { title: string }) => item.title === "Проверка понимания");
    expect(quizActivity.locked).toBe(false);
    const activity = await student.get(`/api/activities/${quizActivity.id}`).set(header).expect(200);
    const started = await student.post(`/api/quizzes/${activity.body.quiz.id}/attempts`).set(header).expect(201);
    const answers = started.body.questions.map((question: { id: string; type: string; prompt: string; payload: Record<string, unknown> }) => ({
      id: question.id,
      response: answerFor(question),
    }));
    await student.put(`/api/attempts/${started.body.id}/answers`).set(header).send({ answers }).expect(200);
    const submitted = await student.post(`/api/attempts/${started.body.id}/submit`).set(header).expect(201);
    expect(submitted.body.state).toBe("pending_review");
    expect(submitted.body.score).toBe(8);
    expect(submitted.body.maxScore).toBe(9);
    const essay = submitted.body.questions.find((question: { type: string }) => question.type === "essay");
    expect(essay.solution.summary).toContain("преподавател");

    const teacher = request.agent(server);
    await teacher.post("/api/auth/login").set(header).send({ email: "teacher@lizon.test", password: "LizonDemo!2026" }).expect(201);
    const graded = await teacher.post(`/api/attempts/${started.body.id}/grade`).set(header).send({ questionId: essay.id, score: 1, comment: "Ясно." }).expect(201);
    expect(graded.body.state).toBe("graded");
    expect(graded.body.score).toBe(9);

    const forbidden = await student.post("/api/courses").set(header).send({ title: "Чужой курс" }).expect(403);
    expect(forbidden.body.code).toBe("forbidden");
  });
});

function answerFor(question: { type: string; prompt: string; payload: Record<string, unknown> }) {
  if (question.prompt.includes("устойчивее")) return { choiceIds: [choiceId(question, "Медиана")] };
  if (question.type === "truefalse") return { value: false };
  if (question.prompt.includes("сантиметров")) return { text: "100" };
  if (question.prompt.includes("процентов")) return { value: 25 };
  if (question.type === "matching") {
    const stems = question.payload.stems as { id: string; text: string }[];
    const options = question.payload.options as { id: string; text: string }[];
    return {
      pairs: [
        { stemId: byText(stems, "Среднее"), optionId: byText(options, "Сумма, делённая на число") },
        { stemId: byText(stems, "Медиана"), optionId: byText(options, "Середина упорядоченного ряда") },
      ],
    };
  }
  if (question.type === "ordering") {
    const items = question.payload.items as { id: string; text: string }[];
    return { order: ["Задать вопрос", "Собрать данные", "Посчитать", "Сделать вывод"].map((text) => byText(items, text)) };
  }
  if (question.type === "cloze") {
    const gaps = question.payload.gaps as { id: string; choices: { id: string; text: string }[] }[];
    return { gaps: [{ id: gaps[0].id, value: gaps[0].choices.find((choice) => choice.text === "пополам")!.id }] };
  }
  if (question.type === "essay") return { text: "Если опросить только удобных людей, среднее описывает не всех, а доступных." };
  if (question.prompt.includes("минут")) return { text: "60" };
  if (question.prompt.includes("дней")) return { text: "7" };
  throw new Error(`unexpected question: ${question.prompt}`);
}

function choiceId(question: { payload: Record<string, unknown> }, text: string) {
  const choices = question.payload.choices as { id: string; text: string }[];
  return choices.find((choice) => choice.text === text)!.id;
}

function byText(items: { id: string; text: string }[], text: string) {
  return items.find((item) => item.text === text)!.id;
}
