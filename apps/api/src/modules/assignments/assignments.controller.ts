import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { AssignmentsService } from "./assignments.service";

@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Put("activities/:activityId/assignment")
  update(@CurrentUser() actor: Actor, @Param("activityId") activityId: string, @Body(new ZodPipe(z.object({ instructions: z.string().optional(), maxMark: z.number().min(0).optional(), maxFiles: z.number().int().min(0).max(10).optional() }))) body: { instructions?: string; maxMark?: number; maxFiles?: number }) {
    return this.assignments.update(actor, activityId, body);
  }

  @Post("assignments/:id/submissions")
  submit(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ text: z.string().max(20000).optional(), fileIds: z.array(z.string()).max(10).optional() }))) body: { text?: string; fileIds?: string[] }) {
    return this.assignments.submit(actor, id, body);
  }

  @Get("assignments/:id/submissions")
  list(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.assignments.list(actor, id);
  }

  @Post("submissions/:id/grade")
  grade(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ score: z.number(), feedback: z.string().max(8000).optional() }))) body: { score: number; feedback?: string }) {
    return this.assignments.grade(actor, id, body);
  }
}
