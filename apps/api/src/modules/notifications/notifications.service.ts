import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string, event: string, input: { title: string; body?: string; link?: string }) {
    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId_event: { userId, event } } });
    const inApp = pref?.inApp ?? true;
    const email = pref?.email ?? false;
    if (inApp) {
      await this.prisma.notification.create({
        data: { userId, type: event, title: input.title, body: input.body ?? "", link: input.link },
      });
    }
    if (email) await this.sendMail(userId, input.title, input.body ?? "");
  }

  async list(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  }

  async markRead(userId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({
      where: { userId, id: ids?.length ? { in: ids } : undefined, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async preferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async updatePreferences(userId: string, items: { event: string; inApp: boolean; email: boolean }[]) {
    for (const item of items) {
      await this.prisma.notificationPreference.upsert({
        where: { userId_event: { userId, event: item.event } },
        update: { inApp: item.inApp, email: item.email },
        create: { userId, event: item.event, inApp: item.inApp, email: item.email },
      });
    }
    return this.preferences(userId);
  }

  /** Создаёт напоминание, если дедлайн ближе двух суток и такого уведомления ещё не было. */
  async scanDeadlines(userId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId, role: "student", status: "active" },
      select: { courseId: true },
    });
    if (!enrollments.length) return;
    const soon = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const activities = await this.prisma.activity.findMany({
      where: {
        courseId: { in: enrollments.map((item) => item.courseId) },
        dueAt: { gt: new Date(), lt: soon },
      },
    });
    const done = new Set(
      (await this.prisma.activityCompletion.findMany({ where: { userId }, select: { activityId: true } })).map((item) => item.activityId),
    );
    for (const activity of activities) {
      if (done.has(activity.id)) continue;
      const link = `/learn/courses/${activity.courseId}/a/${activity.id}`;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existing = await this.prisma.notification.findFirst({
        where: { userId, type: "deadline", link, createdAt: { gt: since } },
      });
      if (existing) continue;
      await this.notify(userId, "deadline", {
        title: `Срок скоро: ${activity.title}`,
        body: activity.dueAt ? activity.dueAt.toLocaleString("ru-RU") : "",
        link,
      });
    }
  }

  private async sendMail(userId: string, subject: string, text: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    if (!process.env.SMTP_HOST) {
      if (process.env.NODE_ENV !== "test") console.info(`[mail] to=${user.email} subject=${subject}`);
      return;
    }
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || "Lizon <noreply@lizon.test>",
      to: user.email,
      subject,
      text,
    });
  }
}
