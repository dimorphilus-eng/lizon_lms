import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, RequirePermissions } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { RbacService } from "./rbac.service";

const roleSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).default([]),
});
const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).optional(),
});

@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get("permissions")
  @RequirePermissions("roles.manage")
  permissions() {
    return this.rbac.permissions();
  }

  @Get("roles")
  @RequirePermissions("roles.manage")
  roles() {
    return this.rbac.roles();
  }

  @Post("roles")
  @RequirePermissions("roles.manage")
  create(@CurrentUser() actor: Actor, @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>) {
    return this.rbac.create(actor, body);
  }

  @Patch("roles/:id")
  @RequirePermissions("roles.manage")
  update(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.rbac.update(actor, id, body);
  }

  @Delete("roles/:id")
  @RequirePermissions("roles.manage")
  remove(@CurrentUser() actor: Actor, @Param("id") id: string) {
    return this.rbac.remove(actor, id);
  }
}
