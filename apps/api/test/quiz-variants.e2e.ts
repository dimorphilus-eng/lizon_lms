import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../dist/app.module";
import { configureApp } from "../dist/main";

const header = { "x-requested-with": "lizon" };

describe("exam variants", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: ["error"], bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("draws a random slot and freezes two distinct exam variants", async () => {
    const teacher = request.agent(app.getHttpServer());
    await teacher.post("/api/auth/login").set(header).send({ email: "teacher@lizon.test", password: "LizonDemo!2026" }).expect(201);
    const courses = await teacher.get("/api/courses?scope=teaching").set(header).expect(200);
    const course = courses.body.find((item: { slug: string }) => item.slug === "data-literacy");
    const outline = await teacher.get(`/api/courses/${course.id}/outline`).set(header).expect(200);
    const moduleId = outline.body.modules[0].id;
    const categories = await teacher.get(`/api/question-categories?courseId=${course.id}`).set(header).expect(200);
    const category = categories.body.find((item: { name: string }) => item.name === "Дата-грамотность");
    const created = await teacher.post(`/api/modules/${moduleId}/activities`).set(header).send({ type: "quiz", title: "Сборка вариантов" }).expect(201);
    const createdIds = [created.body.id as string];
    try {
      await teacher.put(`/api/activities/${created.body.id}/quiz`).set(header).send({
        slots: [
          { questionId: null, maxMark: 1, randomRule: { categoryId: category.id, tags: ["pool"], count: 1 } },
          { questionId: null, maxMark: 1, randomRule: { categoryId: category.id, types: ["multichoice"], count: 1 } },
        ],
      }).expect(200);
      const pool = await teacher.post("/api/question-pool").set(header).send({ categoryId: category.id, tags: ["pool"], courseId: course.id }).expect(201);
      expect(pool.body.total).toBe(2);
      const preview = await teacher.post(`/api/activities/${created.body.id}/quiz/preview`).set(header).expect(201);
      expect(preview.body.questions).toHaveLength(2);
      expect(preview.body.questions[0].source).toBe("random");
      const variants = await teacher.post(`/api/activities/${created.body.id}/quiz/variants`).set(header).send({ count: 2, title: "Экзамен", distinct: true }).expect(201);
      expect(variants.body.variants).toHaveLength(2);
      createdIds.push(...variants.body.variants.map((item: { activityId: string }) => item.activityId));
      expect(variants.body.variants[0].questions[0].type).toBe("shortanswer");
      expect(variants.body.variants[1].questions[0].type).toBe("shortanswer");
      expect(variants.body.variants[0].questions[0].id).not.toBe(variants.body.variants[1].questions[0].id);
      const paper = await teacher.get(`/api/activities/${variants.body.variants[0].activityId}`).set(header).expect(200);
      expect(paper.body.quiz.slots.every((slot: { questionId: string | null }) => slot.questionId)).toBe(true);
      expect(paper.body.activity.title).toBe("Экзамен — вариант 1");
    } finally {
      for (const id of createdIds) await teacher.delete(`/api/activities/${id}`).set(header);
    }
  });
});
