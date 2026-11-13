import { BadRequestException, Injectable } from "@nestjs/common";
import { evaluateAccess, gradeQuestion, type AccessCondition } from "@lizon/shared";
import type { Activity } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { hasPermission } from "../../common/actor";
import { slugify, tr } from "../../common/text";
import { NotificationsService } from "../notifications/notifications.service";
import { PolicyService } from "../access/policy.service";
import { ProgressService } from "../access/progress.service";
import { presentContent, sanitizeIncomingContent, type LessonContent } from "./content";

const ACTIVITY_TYPES = new Set(["lesson", "quiz", "assignment", "forum", "resource", "interactive"]);

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: Actor, scope: string) {
    if (scope === "all") {
      if (!this.policy.canManage(actor) && !hasPermission(actor, "courses.update")) this.policy.forbid(actor);
      return this.prisma.course.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { enrollments: true } } } });
    }
    if (scope === "teaching") {
      return this.prisma.course.findMany({
        where: {
          OR: [
            { createdById: actor.id },
            { enrollments: { some: { userId: actor.id, role: { in: ["teacher", "assistant"] } } } },
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
    }
    if (scope === "catalog") {
      return this.prisma.course.findMany({ where: { status: "published" }, orderBy: { title: "asc" } });
    }
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId: actor.id, role: "student", status: "active" },
      include: { course: true },
      orderBy: { createdAt: "desc" },
    });
    return enrollments.map((item) => ({ ...item.course, progress: item.progress, courseGrade: item.courseGrade, completedAt: item.completedAt }));
  }

  async create(actor: Actor, input: { title: string; summary?: string; language?: string; enrollmentMode?: string; metadata?: Record<string, unknown> }) {
    const slug = await this.uniqueSlug(slugify(input.title));
    const course = await this.prisma.course.create({
      data: {
        title: input.title.trim(),
        slug,
        summary: input.summary ?? "",
        language: input.language === "en" ? "en" : "ru",
        enrollmentMode: input.enrollmentMode === "open" ? "open" : "manual",
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        createdById: actor.id,
        status: "draft",
      },
    });
    await this.prisma.enrollment.create({ data: { userId: actor.id, courseId: course.id, role: "teacher" } });
    await this.prisma.module.create({ data: { courseId: course.id, title: actor.locale === "en" ? "Start" : "Начало", position: 0 } });
    return course;
  }

  async get(actor: Actor, id: string) {
    const course = await this.policy.courseFor(actor, id);
    if (!this.policy.canReadCourse(actor, course)) this.policy.forbid(actor);
    return course;
  }

  async update(actor: Actor, id: string, input: Record<string, unknown>) {
    const course = await this.policy.courseFor(actor, id);
    this.policy.assertTeach(actor, course);
    if (input.status === "published" && !hasPermission(actor, "courses.publish") && !this.policy.canManage(actor)) this.policy.forbid(actor);
    const data: Prisma.CourseUpdateInput = {};
    for (const key of ["title", "summary", "language", "enrollmentMode", "status"] as const) {
      if (typeof input[key] === "string") data[key] = input[key] as string;
    }
    if (typeof input.passingGrade === "number") data.passingGrade = input.passingGrade;
    if (typeof input.certificateEnabled === "boolean") data.certificateEnabled = input.certificateEnabled;
    if (input.metadata && typeof input.metadata === "object") data.metadata = input.metadata as Prisma.InputJsonValue;
    if (typeof input.startDate === "string") data.startDate = new Date(input.startDate);
    if (typeof input.endDate === "string") data.endDate = new Date(input.endDate);
    return this.prisma.course.update({ where: { id }, data });
  }

  async remove(actor: Actor, id: string) {
    const course = await this.policy.courseFor(actor, id);
    if (!hasPermission(actor, "courses.delete") && !this.policy.canManage(actor)) this.policy.forbid(actor);
    this.policy.assertTeach(actor, course);
    await this.prisma.course.delete({ where: { id } });
    return { ok: true };
  }

  async enroll(actor: Actor, courseId: string, input: { userId?: string; role?: string }) {
    const course = await this.policy.courseFor(actor, courseId);
    const self = !input.userId || input.userId === actor.id;
    if (self) {
      if (course.enrollmentMode !== "open" && !course.enrollment) this.policy.forbid(actor);
      if (course.status !== "published" && !this.policy.canTeach(actor, course)) this.policy.forbid(actor);
    } else if (!this.policy.canTeach(actor, course) && !hasPermission(actor, "courses.enroll")) {
      this.policy.forbid(actor);
    }
    const userId = input.userId || actor.id;
    const role = self ? "student" : input.role === "teacher" || input.role === "assistant" ? input.role : "student";
    const enrollment = await this.prisma.enrollment.upsert({
      where: { userId_courseId: { userId, courseId } },
      update: { role, status: "active" },
      create: { userId, courseId, role },
    });
    if (role === "student") {
      await this.notifications.notify(userId, "enrollment", {
        title: tr(actor.locale, `Вы записаны: ${course.title}`, `You are enrolled: ${course.title}`),
        link: `/learn/courses/${course.id}`,
      });
    }
    return enrollment;
  }

  async removeEnrollment(actor: Actor, id: string) {
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, enrollment.courseId);
    if (enrollment.userId !== actor.id) this.policy.assertTeach(actor, course);
    await this.prisma.enrollment.delete({ where: { id } });
    return { ok: true };
  }

  async outline(actor: Actor, courseId: string) {
    const course = await this.policy.courseFor(actor, courseId);
    if (!this.policy.canReadCourse(actor, course)) this.policy.forbid(actor);
    const context = await this.accessContext(actor.id, courseId);
    const modules = await this.prisma.module.findMany({
      where: { courseId },
      orderBy: { position: "asc" },
      include: { activities: { orderBy: { position: "asc" } } },
    });
    const teacher = this.policy.canTeach(actor, course);
    return {
      course: { id: course.id, title: course.title, slug: course.slug, summary: course.summary, language: course.language, status: course.status, enrollmentMode: course.enrollmentMode, passingGrade: course.passingGrade, certificateEnabled: course.certificateEnabled, metadata: course.metadata },
      enrollment: course.enrollment,
      teacher,
      modules: modules.map((module) => {
        const moduleLock = teacher ? { open: true } : this.lockOf(module.availability, null, context);
        return {
          id: module.id,
          title: module.title,
          summary: module.summary,
          position: module.position,
          locked: !moduleLock.open,
          lockReason: moduleLock.reason ?? null,
          activities: module.activities.map((activity) => {
            const lock = teacher || !moduleLock.open ? moduleLock : this.lockOf(activity.availability, activity, context);
            const effective = teacher ? { open: true as const } : !moduleLock.open ? moduleLock : lock;
            return {
              id: activity.id,
              title: activity.title,
              type: activity.type,
              position: activity.position,
              dueAt: activity.dueAt,
              openAt: activity.openAt,
              closeAt: activity.closeAt,
              locked: !effective.open,
              lockReason: effective.open ? null : effective.reason ?? "requires_completion",
              completed: context.completed.has(activity.id),
            };
          }),
        };
      }),
    };
  }

  async addModule(actor: Actor, courseId: string, title: string) {
    const course = await this.policy.courseFor(actor, courseId);
    this.policy.assertTeach(actor, course);
    const last = await this.prisma.module.findFirst({ where: { courseId }, orderBy: { position: "desc" } });
    return this.prisma.module.create({ data: { courseId, title, position: (last?.position ?? -1) + 1 } });
  }

  async updateModule(actor: Actor, id: string, input: { title?: string; summary?: string; availability?: AccessCondition | null }) {
    const module = await this.moduleOf(actor, id);
    return this.prisma.module.update({
      where: { id },
      data: {
        title: input.title,
        summary: input.summary,
        availability: input.availability === undefined ? undefined : input.availability === null ? Prisma.JsonNull : (input.availability as Prisma.InputJsonValue),
      },
    });
  }

  async deleteModule(actor: Actor, id: string) {
    await this.moduleOf(actor, id);
    await this.prisma.module.delete({ where: { id } });
    return { ok: true };
  }

  async reorderModules(actor: Actor, courseId: string, ids: string[]) {
    const course = await this.policy.courseFor(actor, courseId);
    this.policy.assertTeach(actor, course);
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.module.update({ where: { id }, data: { position } })));
    return { ok: true };
  }

  async addActivity(actor: Actor, moduleId: string, input: { type: string; title: string }) {
    if (!ACTIVITY_TYPES.has(input.type)) throw new BadRequestException({ message: "Неизвестный тип активности.", code: "activity_type" });
    const module = await this.moduleOf(actor, moduleId);
    const last = await this.prisma.activity.findFirst({ where: { moduleId }, orderBy: { position: "desc" } });
    const activity = await this.prisma.activity.create({
      data: {
        courseId: module.courseId,
        moduleId,
        type: input.type,
        title: input.title,
        position: (last?.position ?? -1) + 1,
        content: input.type === "forum" || input.type === "lesson" || input.type === "resource" || input.type === "interactive" ? { format: "markdown", body: "", blocks: [] } : undefined,
      },
    });
    if (input.type === "quiz") {
      await this.prisma.quiz.create({ data: { activityId: activity.id } });
    }
    if (input.type === "assignment") {
      await this.prisma.assignment.create({ data: { activityId: activity.id, instructions: "" } });
    }
    return activity;
  }

  async getActivity(actor: Actor, id: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
      include: { quiz: { include: { slots: { orderBy: { position: "asc" }, include: { question: true } } } }, assignment: true },
    });
    if (!activity) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, activity.courseId);
    if (!this.policy.canReadCourse(actor, course)) this.policy.forbid(actor);
    const teacher = this.policy.canTeach(actor, course);
    if (!teacher) this.policy.assertContent(actor, course);
    const context = await this.accessContext(actor.id, activity.courseId);
    const module = await this.prisma.module.findUnique({ where: { id: activity.moduleId } });
    const moduleLock = teacher ? { open: true } : this.lockOf(module?.availability, null, context);
    const lock = teacher ? { open: true } : !moduleLock.open ? moduleLock : this.lockOf(activity.availability, activity, context);
    if (!lock.open) {
      return { activity: { id: activity.id, title: activity.title, type: activity.type, locked: true, lockReason: lock.reason }, quiz: null, assignment: null };
    }
    if (!teacher && this.progress.completionRule(activity).type === "view") {
      await this.progress.complete(actor.id, activity.id);
    }
    return {
      activity: {
        ...activity,
        content: presentContent(activity.content, teacher),
        locked: false,
        completed: context.completed.has(activity.id),
        quiz: undefined,
        assignment: undefined,
      },
      quiz: teacher ? activity.quiz : activity.quiz ? { id: activity.quiz.id, timeLimitSec: activity.quiz.timeLimitSec, attemptsAllowed: activity.quiz.attemptsAllowed, shuffleQuestions: activity.quiz.shuffleQuestions, feedbackMode: activity.quiz.feedbackMode, questionsPerPage: activity.quiz.questionsPerPage, passFraction: activity.quiz.passFraction, gradeMethod: activity.quiz.gradeMethod } : null,
      assignment: activity.assignment ? { id: activity.assignment.id, instructions: activity.assignment.instructions, maxMark: activity.assignment.maxMark, maxFiles: activity.assignment.maxFiles, dueAt: activity.dueAt } : null,
    };
  }

  async updateActivity(actor: Actor, id: string, input: Record<string, unknown>) {
    const activity = await this.ownedActivity(actor, id);
    const data: Prisma.ActivityUpdateInput = {};
    if (typeof input.title === "string") data.title = input.title;
    if (typeof input.weight === "number") data.weight = input.weight;
    if (input.availability !== undefined) data.availability = input.availability === null ? Prisma.JsonNull : (input.availability as Prisma.InputJsonValue);
    if (input.completion !== undefined) data.completion = input.completion === null ? Prisma.JsonNull : (input.completion as Prisma.InputJsonValue);
    for (const key of ["openAt", "dueAt", "closeAt"] as const) {
      if (input[key] === null) data[key] = null;
      else if (typeof input[key] === "string") data[key] = new Date(input[key] as string);
    }
    if (input.content !== undefined) data.content = sanitizeIncomingContent(input.content as LessonContent) as Prisma.InputJsonValue;
    const version = activity.version + 1;
    data.version = version;
    const updated = await this.prisma.activity.update({ where: { id }, data });
    await this.prisma.contentVersion.create({
      data: {
        activityId: id,
        version,
        createdById: actor.id,
        note: typeof input.note === "string" ? input.note : "",
        snapshot: { title: updated.title, content: updated.content, availability: updated.availability, completion: updated.completion, openAt: updated.openAt, dueAt: updated.dueAt, closeAt: updated.closeAt, weight: updated.weight } as Prisma.InputJsonValue,
      },
    });
    return updated;
  }

  async versions(actor: Actor, id: string) {
    await this.ownedActivity(actor, id);
    return this.prisma.contentVersion.findMany({ where: { activityId: id }, orderBy: { version: "desc" } });
  }

  async restore(actor: Actor, id: string, version: number) {
    const activity = await this.ownedActivity(actor, id);
    const snapshot = await this.prisma.contentVersion.findUnique({ where: { activityId_version: { activityId: id, version } } });
    if (!snapshot) this.policy.missing(actor);
    const body = snapshot.snapshot as Record<string, unknown>;
    return this.updateActivity(actor, activity.id, { ...body, note: `restore ${version}` });
  }

  async deleteActivity(actor: Actor, id: string) {
    await this.ownedActivity(actor, id);
    await this.prisma.activity.delete({ where: { id } });
    return { ok: true };
  }

  async reorderActivities(actor: Actor, moduleId: string, ids: string[]) {
    await this.moduleOf(actor, moduleId);
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.activity.update({ where: { id }, data: { position } })));
    return { ok: true };
  }

  async markComplete(actor: Actor, id: string) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, activity.courseId);
    this.policy.assertContent(actor, course);
    const rule = this.progress.completionRule(activity);
    if (rule.type !== "view") {
      throw new BadRequestException({ message: tr(actor.locale, "Этот элемент завершается сдачей работы.", "This item is completed by submission."), code: "completion" });
    }
    await this.progress.complete(actor.id, id);
    return { ok: true };
  }

  async practice(actor: Actor, activityId: string, input: { blockId: string; questionId: string; response: unknown }) {
    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, activity.courseId);
    this.policy.assertContent(actor, course);
    const content = activity.content as LessonContent | null;
    const block = content?.blocks?.find((item) => item.id === input.blockId && item.type === "quiz");
    const question = block?.questions?.find((item) => item.id === input.questionId);
    if (!question) this.policy.missing(actor);
    const result = gradeQuestion({
      type: question.type,
      definition: question.definition,
      response: input.response,
      maxScore: 1,
      locale: actor.locale === "en" ? "en" : "ru",
      mode: "immediate",
      finalized: true,
    });
    return { fraction: result.fraction, feedback: result.feedback, needsManual: result.needsManual };
  }

  async analytics(actor: Actor, courseId: string) {
    const course = await this.policy.courseFor(actor, courseId);
    this.policy.assertTeach(actor, course);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId, role: "student" },
      include: { user: true },
    });
    const grades = await this.prisma.grade.findMany({ where: { courseId } });
    return {
      learners: enrollments.length,
      averageProgress: enrollments.length ? enrollments.reduce((sum, item) => sum + item.progress, 0) / enrollments.length : 0,
      students: enrollments.map((item) => ({
        id: item.userId,
        name: `${item.user.firstName} ${item.user.lastName}`,
        email: item.user.email,
        progress: item.progress,
        courseGrade: item.courseGrade,
        completedAt: item.completedAt,
        grades: grades.filter((grade) => grade.userId === item.userId),
      })),
    };
  }

  async addGroup(actor: Actor, courseId: string, name: string) {
    const course = await this.policy.courseFor(actor, courseId);
    this.policy.assertTeach(actor, course);
    return this.prisma.courseGroup.create({ data: { courseId, name } });
  }

  async addGroupMember(actor: Actor, groupId: string, userId: string) {
    const group = await this.prisma.courseGroup.findUnique({ where: { id: groupId } });
    if (!group) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, group.courseId);
    this.policy.assertTeach(actor, course);
    await this.prisma.groupMember.create({ data: { groupId, userId } });
    return { ok: true };
  }

  async removeGroupMember(actor: Actor, groupId: string, userId: string) {
    const group = await this.prisma.courseGroup.findUnique({ where: { id: groupId } });
    if (!group) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, group.courseId);
    this.policy.assertTeach(actor, course);
    await this.prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
    return { ok: true };
  }

  async groups(actor: Actor, courseId: string) {
    const course = await this.policy.courseFor(actor, courseId);
    if (!this.policy.canReadCourse(actor, course)) this.policy.forbid(actor);
    return this.prisma.courseGroup.findMany({ where: { courseId }, include: { members: true } });
  }

  private async moduleOf(actor: Actor, id: string) {
    const module = await this.prisma.module.findUnique({ where: { id } });
    if (!module) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, module.courseId);
    this.policy.assertTeach(actor, course);
    return module;
  }

  private async ownedActivity(actor: Actor, id: string) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, activity.courseId);
    this.policy.assertTeach(actor, course);
    return activity;
  }

  private async uniqueSlug(base: string) {
    let slug = base;
    let n = 2;
    while (await this.prisma.course.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
    return slug;
  }

  private async accessContext(userId: string, courseId: string) {
    const [completions, grades, memberships] = await Promise.all([
      this.prisma.activityCompletion.findMany({ where: { userId, activity: { courseId } } }),
      this.prisma.grade.findMany({ where: { userId, courseId, status: "graded" } }),
      this.prisma.groupMember.findMany({ where: { userId, group: { courseId } } }),
    ]);
    return {
      completed: new Set(completions.map((item) => item.activityId)),
      grades: Object.fromEntries(grades.map((grade) => [grade.activityId, grade.fraction])),
      groupIds: memberships.map((item) => item.groupId),
    };
  }

  private lockOf(availability: unknown, activity: Activity | null, context: { completed: Set<string>; grades: Record<string, number>; groupIds: string[] }) {
    const now = new Date();
    if (activity?.openAt && now < activity.openAt) return { open: false, reason: "not_yet_open" as const };
    if (activity?.closeAt && now > activity.closeAt) return { open: false, reason: "closed" as const };
    return evaluateAccess(availability as AccessCondition | null, { now, completedActivityIds: context.completed, grades: context.grades, groupIds: context.groupIds });
  }
}
