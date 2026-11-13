import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, Public, RequirePermissions } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { AdminService } from "./admin.service";

const fieldSchema = z.object({
  entity: z.enum(["user", "course"]),
  key: z.string().regex(/^[a-z0-9_]{2,40}$/),
  label: z.string().min(1).max(80),
  fieldType: z.enum(["text", "number", "select", "date"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Public()
  @Get("health")
  health() {
    return { ok: true, service: "lizon-api" };
  }

  @Get("settings")
  settings() {
    return this.admin.settings();
  }

  @Put("settings")
  @RequirePermissions("settings.manage")
  updateSettings(@Body() body: Record<string, unknown>) {
    return this.admin.updateSettings(body);
  }

  @Get("custom-fields")
  fields() {
    return this.admin.fields();
  }

  @Post("custom-fields")
  @RequirePermissions("settings.manage")
  createField(@Body(new ZodPipe(fieldSchema)) body: z.infer<typeof fieldSchema>) {
    return this.admin.createField(body);
  }

  @Patch("custom-fields/:id")
  @RequirePermissions("settings.manage")
  updateField(@Param("id") id: string, @Body() body: { label?: string; required?: boolean; options?: unknown }) {
    return this.admin.updateField(id, body);
  }

  @Delete("custom-fields/:id")
  @RequirePermissions("settings.manage")
  deleteField(@Param("id") id: string) {
    return this.admin.deleteField(id);
  }

  @Get("templates")
  templates() {
    return this.admin.templates();
  }

  @Post("templates")
  @RequirePermissions("templates.manage")
  createTemplate(@CurrentUser() actor: Actor, @Body(new ZodPipe(z.object({ name: z.string().min(1), description: z.string().optional(), blueprint: z.unknown() }))) body: { name: string; description?: string; blueprint: unknown }) {
    return this.admin.createTemplate(actor, body);
  }

  @Post("templates/:id/instantiate")
  @RequirePermissions("courses.create")
  instantiate(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ title: z.string().optional() }))) body: { title?: string }) {
    return this.admin.instantiate(actor, id, body.title);
  }
}
