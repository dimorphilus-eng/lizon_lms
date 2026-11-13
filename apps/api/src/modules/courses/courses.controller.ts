import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, RequirePermissions } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { CoursesService } from "./courses.service";

const condition: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("date"), from: z.string().nullable().optional(), until: z.string().nullable().optional() }),
    z.object({ type: z.literal("completion"), activityId: z.string() }),
    z.object({ type: z.literal("grade"), activityId: z.string(), minFraction: z.number() }),
    z.object({ type: z.literal("group"), groupIds: z.array(z.string()) }),
    z.object({ type: z.literal("all"), conditions: z.array(condition) }),
    z.object({ type: z.literal("any"), conditions: z.array(condition) }),
  ]),
);

const courseSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(4000).optional(),
  language: z.enum(["ru", "en"]).optional(),
  enrollmentMode: z.enum(["manual", "open"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});
const coursePatch = courseSchema.partial().extend({
  status: z.enum(["draft", "published", "archived"]).optional(),
  passingGrade: z.number().min(0).max(1).optional(),
  certificateEnabled: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

@Controller()
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get("courses")
  list(@CurrentUser() actor: Actor, @Query("scope") scope = "mine") {
    return this.courses.list(actor, scope);
  }

  @Post("courses")
  @RequirePermissions("courses.create")
  create(@CurrentUser() actor: Actor, @Body(new ZodPipe(courseSchema)) body: z.infer<typeof courseSchema>) {
    return this.courses.create(actor, body);
  }

  @Get("courses/:id")
  get(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.get(actor, id);
  }

  @Patch("courses/:id")
  update(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(coursePatch)) body: z.infer<typeof coursePatch>) {
    return this.courses.update(actor, id, body);
  }

  @Delete("courses/:id")
  remove(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.remove(actor, id);
  }

  @Get("courses/:id/outline")
  outline(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.outline(actor, id);
  }

  @Get("courses/:id/analytics")
  analytics(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.analytics(actor, id);
  }

  @Post("courses/:id/enrollments")
  enroll(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ userId: z.string().optional(), role: z.enum(["student", "teacher", "assistant"]).optional() }))) body: { userId?: string; role?: string }) {
    return this.courses.enroll(actor, id, body);
  }

  @Delete("enrollments/:id")
  unenroll(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.removeEnrollment(actor, id);
  }

  @Post("courses/:id/modules")
  addModule(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ title: z.string().min(1).max(160) }))) body: { title: string }) {
    return this.courses.addModule(actor, id, body.title);
  }

  @Patch("modules/:id")
  updateModule(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ title: z.string().optional(), summary: z.string().optional(), availability: condition.nullable().optional() }))) body: { title?: string; summary?: string; availability?: unknown }) {
    return this.courses.updateModule(actor, id, body as never);
  }

  @Delete("modules/:id")
  deleteModule(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.deleteModule(actor, id);
  }

  @Post("courses/:id/modules/reorder")
  reorderModules(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ ids: z.array(z.string()) }))) body: { ids: string[] }) {
    return this.courses.reorderModules(actor, id, body.ids);
  }

  @Post("modules/:id/activities")
  addActivity(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ type: z.string(), title: z.string().min(1).max(160) }))) body: { type: string; title: string }) {
    return this.courses.addActivity(actor, id, body);
  }

  @Get("activities/:id")
  activity(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.getActivity(actor, id);
  }

  @Patch("activities/:id")
  updateActivity(@CurrentUser() actor: Actor, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.courses.updateActivity(actor, id, body);
  }

  @Delete("activities/:id")
  deleteActivity(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.deleteActivity(actor, id);
  }

  @Post("modules/:id/activities/reorder")
  reorderActivities(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ ids: z.array(z.string()) }))) body: { ids: string[] }) {
    return this.courses.reorderActivities(actor, id, body.ids);
  }

  @Get("activities/:id/versions")
  versions(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.versions(actor, id);
  }

  @Post("activities/:id/restore")
  restore(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ version: z.number().int() }))) body: { version: number }) {
    return this.courses.restore(actor, id, body.version);
  }

  @Post("activities/:id/complete")
  complete(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.markComplete(actor, id);
  }

  @Post("activities/:id/practice")
  practice(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ blockId: z.string(), questionId: z.string(), response: z.unknown() }))) body: { blockId: string; questionId: string; response: unknown }) {
    return this.courses.practice(actor, id, body);
  }

  @Get("courses/:id/groups")
  groups(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.courses.groups(actor, id);
  }

  @Post("courses/:id/groups")
  addGroup(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ name: z.string().min(1).max(80) }))) body: { name: string }) {
    return this.courses.addGroup(actor, id, body.name);
  }

  @Post("groups/:id/members")
  addMember(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ userId: z.string() }))) body: { userId: string }) {
    return this.courses.addGroupMember(actor, id, body.userId);
  }

  @Delete("groups/:id/members/:userId")
  removeMember(@CurrentUser() actor: Actor, @Param("id") id: string, @Param("userId") userId: string) {
    return this.courses.removeGroupMember(actor, id, userId);
  }
}
