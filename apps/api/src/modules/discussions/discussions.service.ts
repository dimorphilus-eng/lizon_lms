import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { PolicyService } from "../access/policy.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class DiscussionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: Actor, activityId: string) {
    const activity = await this.activity(actor, activityId);
    const posts = await this.prisma.discussionPost.findMany({
      where: { activityId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    return { activityId: activity.id, posts };
  }

  async create(actor: Actor, activityId: string, input: { body: string; parentId?: string }) {
    const activity = await this.activity(actor, activityId);
    const text = input.body.trim();
    const post = await this.prisma.discussionPost.create({
      data: { activityId, authorId: actor.id, parentId: input.parentId, body: text },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (input.parentId) {
      const parent = await this.prisma.discussionPost.findUnique({ where: { id: input.parentId } });
      if (parent && parent.authorId !== actor.id) {
        await this.notifications.notify(parent.authorId, "discussion", {
          title: activity.title,
          body: text.slice(0, 180),
          link: `/learn/courses/${activity.courseId}/a/${activity.id}`,
        });
      }
    }
    return post;
  }

  async remove(actor: Actor, id: string) {
    const post = await this.prisma.discussionPost.findUnique({ where: { id }, include: { activity: true } });
    if (!post) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, post.activity.courseId);
    if (post.authorId !== actor.id && !this.policy.canTeach(actor, course)) this.policy.forbid(actor);
    await this.prisma.discussionPost.delete({ where: { id } });
    return { ok: true };
  }

  private async activity(actor: Actor, activityId: string) {
    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) this.policy.missing(actor);
    const course = await this.policy.courseFor(actor, activity.courseId);
    if (!this.policy.canReadContent(actor, course) && !this.policy.canTeach(actor, course)) this.policy.forbid(actor);
    return activity;
  }
}
