import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Course, Enrollment } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { hasPermission } from "../../common/actor";
import { tr } from "../../common/text";

@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  forbid(actor: Actor): never {
    throw new ForbiddenException({ message: tr(actor.locale, "Недостаточно прав.", "You do not have permission."), code: "forbidden" });
  }

  missing(actor: Actor): never {
    throw new NotFoundException({ message: tr(actor.locale, "Не найдено.", "Not found."), code: "not_found" });
  }

  async courseFor(actor: Actor, courseId: string): Promise<Course & { enrollment: Enrollment | null }> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) this.missing(actor);
    const enrollment = await this.prisma.enrollment.findUnique({ where: { userId_courseId: { userId: actor.id, courseId } } });
    return { ...course, enrollment };
  }

  canManage(actor: Actor): boolean {
    return hasPermission(actor, "courses.manage");
  }

  canTeach(actor: Actor, course: Course & { enrollment: Enrollment | null }): boolean {
    if (this.canManage(actor)) return true;
    if (course.createdById === actor.id && (hasPermission(actor, "courses.update") || hasPermission(actor, "content.author"))) return true;
    return course.enrollment?.role === "teacher" || course.enrollment?.role === "assistant";
  }

  canReadCourse(actor: Actor, course: Course & { enrollment: Enrollment | null }): boolean {
    if (this.canTeach(actor, course)) return true;
    if (course.enrollment && course.enrollment.status === "active") return true;
    return course.status === "published" && hasPermission(actor, "courses.read");
  }

  canReadContent(actor: Actor, course: Course & { enrollment: Enrollment | null }): boolean {
    if (this.canTeach(actor, course)) return true;
    return Boolean(course.enrollment && course.enrollment.status === "active");
  }

  assertTeach(actor: Actor, course: Course & { enrollment: Enrollment | null }) {
    if (!this.canTeach(actor, course)) this.forbid(actor);
  }

  assertContent(actor: Actor, course: Course & { enrollment: Enrollment | null }) {
    if (!this.canReadContent(actor, course)) this.forbid(actor);
  }
}
