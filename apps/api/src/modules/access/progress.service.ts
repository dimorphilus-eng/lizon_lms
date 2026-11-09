import { Injectable } from "@nestjs/common";
import type { Activity, Course } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { randomId } from "../../common/tokens";

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async complete(userId: string, activityId: string) {
    await this.prisma.activityCompletion.upsert({
      where: { userId_activityId: { userId, activityId } },
      update: {},
      create: { userId, activityId },
    });
    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) return;
    await this.prisma.enrollment.updateMany({
      where: { userId, courseId: activity.courseId },
      data: { lastActivityId: activityId },
    });
    await this.recompute(userId, activity.courseId);
  }

  async recompute(userId: string, courseId: string) {
    const [course, activities, completions, grades] = await Promise.all([
      this.prisma.course.findUnique({ where: { id: courseId } }),
      this.prisma.activity.findMany({ where: { courseId } }),
      this.prisma.activityCompletion.findMany({ where: { userId, activity: { courseId } } }),
      this.prisma.grade.findMany({ where: { userId, courseId } }),
    ]);
    if (!course) return;
    const done = new Set(completions.map((item) => item.activityId));
    const progress = activities.length ? done.size / activities.length : 0;
    const gradeable = activities.filter((activity) => activity.type === "quiz" || activity.type === "assignment");
    let weighted = 0;
    let weightSum = 0;
    for (const grade of grades) {
      if (grade.status !== "graded") continue;
      const activity = activities.find((item) => item.id === grade.activityId);
      const weight = activity?.weight ?? 1;
      weighted += grade.fraction * weight;
      weightSum += weight;
    }
    const courseGrade = weightSum ? weighted / weightSum : null;
    const pending = grades.some((grade) => grade.status === "pending");
    const allDone = activities.every((activity) => done.has(activity.id));
    const allGraded = gradeable.every((activity) => grades.some((grade) => grade.activityId === activity.id && grade.status === "graded"));
    const passed = courseGrade === null ? gradeable.length === 0 : courseGrade >= course.passingGrade;
    const finished = allDone && !pending && allGraded && passed;
    await this.prisma.enrollment.updateMany({
      where: { userId, courseId, role: "student" },
      data: {
        progress,
        courseGrade,
        completedAt: finished ? new Date() : null,
      },
    });
    if (finished && course.certificateEnabled) await this.issueCertificate(userId, course);
  }

  async upsertGrade(input: { userId: string; courseId: string; activityId: string; score: number; maxScore: number; status: "graded" | "pending" }) {
    const fraction = input.maxScore > 0 ? input.score / input.maxScore : 0;
    await this.prisma.grade.upsert({
      where: { userId_activityId: { userId: input.userId, activityId: input.activityId } },
      update: { score: input.score, maxScore: input.maxScore, fraction, status: input.status, courseId: input.courseId },
      create: { ...input, fraction },
    });
    await this.recompute(input.userId, input.courseId);
  }

  completionRule(activity: Activity): { type: "view" | "submit" | "pass"; minFraction: number } {
    const value = activity.completion;
    if (value && typeof value === "object" && !Array.isArray(value) && "type" in value) {
      const type = String(value.type);
      const minFraction = "minFraction" in value && typeof value.minFraction === "number" ? value.minFraction : 0.6;
      if (type === "view" || type === "submit" || type === "pass") return { type, minFraction };
    }
    if (activity.type === "quiz" || activity.type === "assignment") return { type: "submit", minFraction: 0.6 };
    return { type: "view", minFraction: 0.6 };
  }

  private async issueCertificate(userId: string, course: Course) {
    const existing = await this.prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } });
    if (existing) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const code = `LZN-${randomId().slice(0, 8).toUpperCase()}`;
    await this.prisma.certificate.create({
      data: {
        userId,
        courseId: course.id,
        code,
        meta: { courseTitle: course.title, learner: `${user.firstName} ${user.lastName}` },
      },
    });
    await this.notifications.notify(userId, "certificate", {
      title: user.locale === "en" ? `Certificate: ${course.title}` : `Сертификат: ${course.title}`,
      body: code,
      link: "/certificates",
    });
  }
}
