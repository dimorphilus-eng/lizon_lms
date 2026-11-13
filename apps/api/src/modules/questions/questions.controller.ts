import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { QuestionsService } from "./questions.service";

const listSchema = z.object({
  categoryId: z.string().optional(),
  courseId: z.string().optional(),
  type: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(40),
  skip: z.coerce.number().int().min(0).default(0),
});

@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get("question-types")
  types() {
    return this.questions.types();
  }

  @Get("question-categories")
  categories(@CurrentUser() actor: Actor, @Query("courseId") courseId?: string) {
    return this.questions.categories(actor, courseId);
  }

  @Post("question-categories")
  createCategory(@CurrentUser() actor: Actor, @Body(new ZodPipe(z.object({ name: z.string().min(1).max(120), courseId: z.string().nullable().optional(), parentId: z.string().nullable().optional() }))) body: { name: string; courseId?: string | null; parentId?: string | null }) {
    return this.questions.createCategory(actor, body);
  }

  @Get("questions")
  list(@CurrentUser() actor: Actor, @Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.questions.list(actor, query);
  }

  @Post("questions")
  create(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.questions.create(actor, body as never);
  }

  @Get("questions/:id")
  get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.questions.get(actor, id);
  }

  @Patch("questions/:id")
  update(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.questions.update(actor, id, body);
  }

  @Delete("questions/:id")
  remove(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.questions.remove(actor, id);
  }

  @Post("questions/import")
  importBank(@CurrentUser() actor: Actor, @Body(new ZodPipe(z.object({ categoryId: z.string(), format: z.enum(["json", "moodle-xml"]).optional(), payload: z.string().min(1) }))) body: { categoryId: string; format?: "json" | "moodle-xml"; payload: string }) {
    return this.questions.import(actor, body);
  }

  @Post("questions/export")
  exportBank(@CurrentUser() actor: Actor, @Body(new ZodPipe(z.object({ ids: z.array(z.string()).optional(), categoryId: z.string().optional(), format: z.enum(["json", "moodle-xml"]) }))) body: { ids?: string[]; categoryId?: string; format: "json" | "moodle-xml" }) {
    return this.questions.export(actor, body);
  }
}
