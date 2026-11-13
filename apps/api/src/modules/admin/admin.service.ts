import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { tr } from "../../common/text";
import { CoursesService } from "../courses/courses.service";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
  ) {}

  async settings() {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async updateSettings(input: Record<string, unknown>) {
    for (const [key, value] of Object.entries(input)) {
      await this.prisma.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
    }
    return this.settings();
  }

  fields() {
    return this.prisma.customFieldDefinition.findMany({ orderBy: { entity: "asc" } });
  }

  createField(input: { entity: string; key: string; label: string; fieldType: string; options?: unknown; required?: boolean }) {
    return this.prisma.customFieldDefinition.create({
      data: {
        entity: input.entity,
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        options: (input.options ?? []) as Prisma.InputJsonValue,
        required: Boolean(input.required),
      },
    });
  }

  async updateField(id: string, input: { label?: string; required?: boolean; options?: unknown }) {
    return this.prisma.customFieldDefinition.update({
      where: { id },
      data: { label: input.label, required: input.required, options: input.options === undefined ? undefined : (input.options as Prisma.InputJsonValue) },
    });
  }

  async deleteField(id: string) {
    await this.prisma.customFieldDefinition.delete({ where: { id } });
    return { ok: true };
  }

  templates() {
    return this.prisma.courseTemplate.findMany({ orderBy: { createdAt: "desc" } });
  }

  createTemplate(actor: Actor, input: { name: string; description?: string; blueprint: unknown }) {
    return this.prisma.courseTemplate.create({
      data: { name: input.name, description: input.description ?? "", blueprint: input.blueprint as Prisma.InputJsonValue, createdById: actor.id },
    });
  }

  async instantiate(actor: Actor, id: string, title?: string) {
    const template = await this.prisma.courseTemplate.findUnique({ where: { id } });
    if (!template) throw new BadRequestException({ message: tr(actor.locale, "Шаблон не найден.", "Template not found."), code: "not_found" });
    const blueprint = template.blueprint as { summary?: string; modules?: { title: string; summary?: string; activities?: { type: string; title: string }[] }[] };
    const course = await this.courses.create(actor, { title: title || template.name, summary: blueprint.summary || template.description });
    const existing = await this.prisma.module.findMany({ where: { courseId: course.id } });
    if (existing.length === 1 && blueprint.modules?.length) {
      await this.prisma.module.delete({ where: { id: existing[0].id } });
    }
    for (const [index, module] of (blueprint.modules ?? []).entries()) {
      const created = await this.prisma.module.create({ data: { courseId: course.id, title: module.title, summary: module.summary ?? "", position: index } });
      for (const [position, activity] of (module.activities ?? []).entries()) {
        const row = await this.prisma.activity.create({
          data: { courseId: course.id, moduleId: created.id, type: activity.type, title: activity.title, position, content: { format: "markdown", body: "", blocks: [] } },
        });
        if (activity.type === "quiz") await this.prisma.quiz.create({ data: { activityId: row.id } });
        if (activity.type === "assignment") await this.prisma.assignment.create({ data: { activityId: row.id } });
      }
    }
    return course;
  }
}
