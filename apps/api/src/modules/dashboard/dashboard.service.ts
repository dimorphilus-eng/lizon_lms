import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async student(actor: Actor) {
    await this.notifications.scanDeadlines(actor.id);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId: actor.id, role: "student", status: "active" },
      include: { course: true },
    });
    const courseIds = enrollments.map((item) => item.courseId);
    const now = new Date();
    const deadlines = await this.prisma.activity.findMany({
      where: { courseId: { in: courseIds }, dueAt: { gt: now } },
      orderBy: { dueAt: "asc" },
      take: 6,
    });
    const done = new Set((await this.prisma.activityCompletion.findMany({ where: { userId: actor.id }, select: { activityId: true } })).map((item) => item.activityId));
    const certificates = await this.prisma.certificate.count({ where: { userId: actor.id } });
    const unread = await this.prisma.notification.count({ where: { userId: actor.id, readAt: null } });
    return {
      courses: enrollments.map((item) => ({
        id: item.course.id,
        title: item.course.title,
        progress: item.progress,
        courseGrade: item.courseGrade,
        completedAt: item.completedAt,
        continueId: item.lastActivityId,
      })),
      deadlines: deadlines.filter((item) => !done.has(item.id)).map((item) => ({ id: item.id, courseId: item.courseId, title: item.title, type: item.type, dueAt: item.dueAt })),
      certificates,
      unread,
    };
  }

  async teacher(actor: Actor) {
    const courses = await this.prisma.course.findMany({
      where: { OR: [{ createdById: actor.id }, { enrollments: { some: { userId: actor.id, role: { in: ["teacher", "assistant"] } } } }] },
      include: { _count: { select: { enrollments: true } }, enrollments: { where: { role: "student" } } },
    });
    const pendingQuizzes = await this.prisma.attemptQuestion.count({
      where: { needsManual: true, score: null, attempt: { quiz: { activity: { courseId: { in: courses.map((course) => course.id) } } } } },
    });
    const pendingAssignments = await this.prisma.submission.count({
      where: { status: "submitted", assignment: { activity: { courseId: { in: courses.map((course) => course.id) } } } },
    });
    return {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        learners: course.enrollments.length,
        averageProgress: course.enrollments.length ? course.enrollments.reduce((sum, item) => sum + item.progress, 0) / course.enrollments.length : 0,
      })),
      pendingQuizzes,
      pendingAssignments,
    };
  }
}
