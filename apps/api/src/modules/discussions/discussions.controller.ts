import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { DiscussionsService } from "./discussions.service";

@Controller()
export class DiscussionsController {
  constructor(private readonly discussions: DiscussionsService) {}

  @Get("activities/:id/posts")
  list(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.discussions.list(actor, id);
  }

  @Post("activities/:id/posts")
  create(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(z.object({ body: z.string().min(1).max(8000), parentId: z.string().optional() }))) body: { body: string; parentId?: string }) {
    return this.discussions.create(actor, id, body);
  }

  @Delete("posts/:id")
  remove(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.discussions.remove(actor, id);
  }
}
