import { Injectable } from "@nestjs/common";
import {
  emptyDefinition,
  exportQuestions,
  importQuestions,
  listQuestionTypes,
  validateDefinition,
  type ExportQuestion,
} from "@lizon/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { hasPermission } from "../../common/actor";
import { PolicyService } from "../access/policy.service";

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  types() {
    return listQuestionTypes();
  }

  async categories(actor: Actor, courseId?: string) {
    return this.prisma.questionCategory.findMany({
      where: courseId ? { OR: [{ courseId }, { courseId: null }] } : undefined,
      orderBy: { name: "asc" },
      include: { _count: { select: { questions: true } } },
    });
  }

  async createCategory(actor: Actor, input: { name: string; courseId?: string | null; parentId?: string | null }) {
    if (input.courseId) {
      const course = await this.policy.courseFor(actor, input.courseId);
      this.policy.assertTeach(actor, course);
    } else if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    return this.prisma.questionCategory.create({
      data: { name: input.name, courseId: input.courseId ?? null, parentId: input.parentId ?? null },
    });
  }

  async list(actor: Actor, filters: { categoryId?: string; courseId?: string; type?: string; tag?: string; q?: string; take: number; skip: number }) {
    if (!hasPermission(actor, "questions.manage") && !hasPermission(actor, "content.author")) this.policy.forbid(actor);
    const where: Prisma.QuestionWhereInput = {
      categoryId: filters.categoryId,
      type: filters.type,
      category: filters.courseId ? { courseId: filters.courseId } : undefined,
      tags: filters.tag ? { some: { tag: { name: filters.tag } } } : undefined,
      OR: filters.q
        ? [{ name: { contains: filters.q, mode: "insensitive" } }, { text: { contains: filters.q, mode: "insensitive" } }]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        take: filters.take,
        skip: filters.skip,
        orderBy: { updatedAt: "desc" },
        include: { tags: { include: { tag: true } }, category: true },
      }),
      this.prisma.question.count({ where }),
    ]);
    return {
      total,
      items: items.map((question) => ({ ...question, tags: question.tags.map((item) => item.tag.name) })),
    };
  }

  async get(actor: Actor, id: string) {
    if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    const question = await this.prisma.question.findUnique({ where: { id }, include: { tags: { include: { tag: true } }, revisions: { orderBy: { version: "desc" } } } });
    if (!question) this.policy.missing(actor);
    return { ...question, tags: question.tags.map((item) => item.tag.name) };
  }

  async create(actor: Actor, input: { categoryId: string; type: string; name: string; text: string; defaultMark?: number; penalty?: number; generalFeedback?: string; definition?: unknown; tags?: string[]; status?: string }) {
    if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    const definition = input.definition ?? emptyDefinition(input.type);
    validateDefinition(input.type, definition);
    const tags = await this.tags(input.tags ?? []);
    const question = await this.prisma.question.create({
      data: {
        categoryId: input.categoryId,
        type: input.type,
        name: input.name,
        text: input.text,
        defaultMark: input.defaultMark ?? 1,
        penalty: input.penalty ?? 0,
        generalFeedback: input.generalFeedback ?? "",
        definition: definition as Prisma.InputJsonValue,
        status: input.status === "draft" ? "draft" : "ready",
        authorId: actor.id,
        tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
      },
    });
    return question;
  }

  async update(actor: Actor, id: string, input: Record<string, unknown>) {
    if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    const current = await this.prisma.question.findUnique({ where: { id } });
    if (!current) this.policy.missing(actor);
    const type = typeof input.type === "string" ? input.type : current.type;
    const definition = input.definition ?? current.definition;
    validateDefinition(type, definition);
    const version = current.version + 1;
    await this.prisma.questionRevision.create({
      data: { questionId: id, version: current.version, snapshot: current as unknown as Prisma.InputJsonValue },
    });
    if (Array.isArray(input.tags)) {
      const tags = await this.tags(input.tags.filter((tag): tag is string => typeof tag === "string"));
      await this.prisma.questionTag.deleteMany({ where: { questionId: id } });
      await this.prisma.questionTag.createMany({ data: tags.map((tag) => ({ questionId: id, tagId: tag.id })) });
    }
    return this.prisma.question.update({
      where: { id },
      data: {
        type,
        name: typeof input.name === "string" ? input.name : undefined,
        text: typeof input.text === "string" ? input.text : undefined,
        defaultMark: typeof input.defaultMark === "number" ? input.defaultMark : undefined,
        penalty: typeof input.penalty === "number" ? input.penalty : undefined,
        generalFeedback: typeof input.generalFeedback === "string" ? input.generalFeedback : undefined,
        definition: definition as Prisma.InputJsonValue,
        status: input.status === "draft" || input.status === "ready" ? input.status : undefined,
        categoryId: typeof input.categoryId === "string" ? input.categoryId : undefined,
        version,
      },
    });
  }

  async remove(actor: Actor, id: string) {
    if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    await this.prisma.question.delete({ where: { id } });
    return { ok: true };
  }

  async import(actor: Actor, input: { categoryId: string; format?: "json" | "moodle-xml"; payload: string }) {
    if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    const result = importQuestions(input.payload, input.format);
    const created = [];
    for (const question of result.questions) {
      const tags = await this.tags(question.tags);
      const row = await this.prisma.question.create({
        data: {
          categoryId: input.categoryId,
          type: question.type,
          name: question.name,
          text: question.text,
          defaultMark: question.defaultMark,
          penalty: question.penalty,
          generalFeedback: question.generalFeedback,
          definition: question.definition as Prisma.InputJsonValue,
          authorId: actor.id,
          tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
        },
      });
      created.push(row.id);
    }
    return { created, warnings: result.warnings };
  }

  async export(actor: Actor, input: { ids?: string[]; categoryId?: string; format: "json" | "moodle-xml" }) {
    if (!hasPermission(actor, "questions.manage")) this.policy.forbid(actor);
    const questions = await this.prisma.question.findMany({
      where: { id: input.ids?.length ? { in: input.ids } : undefined, categoryId: input.categoryId },
      include: { tags: { include: { tag: true } } },
    });
    const payload: ExportQuestion[] = questions.map((question) => ({
      type: question.type,
      name: question.name,
      text: question.text,
      defaultMark: question.defaultMark,
      penalty: question.penalty,
      generalFeedback: question.generalFeedback,
      definition: question.definition,
      tags: question.tags.map((item) => item.tag.name),
    }));
    return { format: input.format, payload: exportQuestions(payload, input.format) };
  }

  private async tags(names: string[]) {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const rows = [];
    for (const name of unique) {
      rows.push(await this.prisma.tag.upsert({ where: { name }, update: {}, create: { name } }));
    }
    return rows;
  }
}
