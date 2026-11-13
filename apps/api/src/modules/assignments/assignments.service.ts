import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { hasPermission } from "../../common/actor";
import { tr } from "../../common/text";
import { PolicyService } from "../access/policy.service";
import { ProgressService } from "../access/progress.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
  ) {}

  async update(actor: Actor, activityId: string, input: { instructions?: string; maxMark?: number; maxFiles?: number }) {
    const assignment = await this.assignment(actor, activityId, true);
    return this.prisma.assignment.update({
      where: { id: assignment.id },
      data: { instructions: input.instructions, maxMark: input.maxMark, maxFiles: input.maxFiles },
    });
  }

  async submit(actor: Actor, assignmentId: string, input: { text?: string; fileIds?: string[] }) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId }, include: { activity: true } });
    if (!assignment) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, assignment.activity.courseId);
    this.policy.assertContent(actor, course);
    if (assignment.activity.closeAt && assignment.activity.closeAt < new Date()) {
      throw new BadRequestException({ message: tr(actor.locale, "Срок сдачи закрыт.", "Submissions are closed."), code: "closed" });
    }
    const files = (input.fileIds ?? []).slice(0, assignment.maxFiles);
    const submission = await this.prisma.submission.create({
      data: { assignmentId, userId: actor.id, text: input.text ?? "", fileIds: files, status: "submitted" },
    });
    await this.progress.upsertGrade({
      userId: actor.id,
      courseId: assignment.activity.courseId,
      activityId: assignment.activityId,
      score: 0,
      maxScore: assignment.maxMark,
      status: "pending",
    });
    const rule = this.progress.completionRule(assignment.activity);
    if (rule.type === "submit") await this.progress.complete(actor.id, assignment.activityId);
    return { ...submission, late: Boolean(assignment.activity.dueAt && assignment.activity.dueAt < new Date()) };
  }

  async list(actor: Actor, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId }, include: { activity: true } });
    if (!assignment) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, assignment.activity.courseId);
    const teacher = this.policy.canTeach(actor, course);
    return this.prisma.submission.findMany({
      where: { assignmentId, userId: teacher ? undefined : actor.id },
      orderBy: { submittedAt: "desc" },
      include: { user: teacher ? true : false },
    });
  }

  async grade(actor: Actor, submissionId: string, input: { score: number; feedback?: string }) {
    const submission = await this.prisma.submission.findUnique({ where: { id: submissionId }, include: { assignment: { include: { activity: true } }, user: true } });
    if (!submission) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, submission.assignment.activity.courseId);
    if (!this.policy.canTeach(actor, course) && !hasPermission(actor, "assignments.grade")) this.policy.forbid(actor);
    const score = Math.max(0, Math.min(submission.assignment.maxMark, input.score));
    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { score, feedback: input.feedback ?? "", status: "graded", gradedById: actor.id, gradedAt: new Date() },
    });
    await this.progress.upsertGrade({
      userId: submission.userId,
      courseId: submission.assignment.activity.courseId,
      activityId: submission.assignment.activityId,
      score,
      maxScore: submission.assignment.maxMark,
      status: "graded",
    });
    const rule = this.progress.completionRule(submission.assignment.activity);
    const fraction = submission.assignment.maxMark ? score / submission.assignment.maxMark : 0;
    if (rule.type === "pass" && fraction >= rule.minFraction) await this.progress.complete(submission.userId, submission.assignment.activityId);
    await this.notifications.notify(submission.userId, "grade", {
      title: submission.user.locale === "en" ? `Assignment graded: ${submission.assignment.activity.title}` : `Задание проверено: ${submission.assignment.activity.title}`,
      body: input.feedback ?? "",
      link: `/learn/courses/${submission.assignment.activity.courseId}/a/${submission.assignment.activityId}`,
    });
    return updated;
  }

  private async assignment(actor: Actor, activityId: string, teach: boolean) {
    const assignment = await this.prisma.assignment.findUnique({ where: { activityId }, include: { activity: true } });
    if (!assignment) this.policy.missing(actor);
    if (teach) {
      const course = await this.policy.courseFor(actor, assignment.activity.courseId);
      this.policy.assertTeach(actor, course);
    }
    return assignment;
  }
}
