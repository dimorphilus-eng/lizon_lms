import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { QuizzesService } from "./quizzes.service";

const settingsSchema = z.object({
  settings: z.record(z.unknown()).optional(),
  slots: z.array(z.object({
    questionId: z.string().nullable().optional(),
    maxMark: z.number().min(0).optional(),
    randomRule: z.object({
      categoryId: z.string().optional(),
      tags: z.array(z.string()).optional(),
      types: z.array(z.string()).optional(),
      count: z.number().int().min(1).max(50).optional(),
    }).nullable().optional(),
  })).optional(),
});

@Controller()
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Put("activities/:activityId/quiz")
  save(@CurrentUser() actor: Actor, @Param("activityId") activityId: string, @Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.quizzes.saveSettings(actor, activityId, body);
  }

  @Post("quizzes/:quizId/attempts")
  start(@CurrentUser() actor: Actor, @Param("quizId") quizId: string) {
    return this.quizzes.start(actor, quizId);
  }

  @Get("quizzes/:quizId/attempts")
  attempts(@CurrentUser() actor: Actor, @Param("quizId") quizId: string) {
    return this.quizzes.myAttempts(actor, quizId);
  }

  @Get("attempts/:id")
  attempt(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.quizzes.present(actor, id);
  }

  @Put("attempts/:id/answers")
  answers(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ answers: z.array(z.object({ id: z.string(), response: z.unknown() })) }))) body: { answers: { id: string; response: unknown }[] }) {
    return this.quizzes.saveAnswers(actor, id, body.answers);
  }

  @Post("attempts/:id/submit")
  submit(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.quizzes.submit(actor, id);
  }

  @Post("attempts/:id/grade")
  grade(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ questionId: z.string(), score: z.number(), comment: z.string().optional() }))) body: { questionId: string; score: number; comment?: string }) {
    return this.quizzes.gradeManual(actor, id, body);
  }

  @Get("grading/queue")
  queue(@CurrentUser() actor: Actor) {
    return this.quizzes.queue(actor);
  }
}
