import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { NotificationsService } from "./notifications.service";

const readSchema = z.object({ ids: z.array(z.string()).optional() });
const prefsSchema = z.object({
  items: z.array(z.object({ event: z.string().min(1).max(40), inApp: z.boolean(), email: z.boolean() })).max(20),
});

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() actor: Actor) {
    await this.notifications.scanDeadlines(actor.id);
    const items = await this.notifications.list(actor.id);
    return { items, unread: items.filter((item) => !item.readAt).length };
  }

  @Post("read")
  read(@CurrentUser() actor: Actor, @Body(new ZodPipe(readSchema)) body: z.infer<typeof readSchema>) {
    return this.notifications.markRead(actor.id, body.ids);
  }

  @Get("preferences")
  preferences(@CurrentUser() actor: Actor) {
    return this.notifications.preferences(actor.id);
  }

  @Put("preferences")
  update(@CurrentUser() actor: Actor, @Body(new ZodPipe(prefsSchema)) body: z.infer<typeof prefsSchema>) {
    return this.notifications.updatePreferences(actor.id, body.items);
  }
}
