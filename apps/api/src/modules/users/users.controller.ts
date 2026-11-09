import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser, RequirePermissions } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { ZodPipe } from "../../common/zod.pipe";
import { UsersService } from "./users.service";

const listSchema = z.object({
  q: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
  skip: z.coerce.number().int().min(0).default(0),
});
const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  roleCodes: z.array(z.string()).min(1),
});
const updateSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  locale: z.enum(["ru", "en"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  isActive: z.boolean().optional(),
  customFields: z.record(z.unknown()).optional(),
});
const rolesSchema = z.object({ roleCodes: z.array(z.string()).min(1) });

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions("users.read")
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.users.list(query.q, query.take, query.skip);
  }

  @Post()
  @RequirePermissions("users.manage")
  create(@CurrentUser() actor: Actor, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.users.create(actor, body);
  }

  @Patch(":id")
  update(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.users.update(actor, id, body);
  }

  @Put(":id/roles")
  @RequirePermissions("roles.manage")
  setRoles(@CurrentUser() actor: Actor, @Param("id") id: string, @Body(new ZodPipe(rolesSchema)) body: z.infer<typeof rolesSchema>) {
    return this.users.setRoles(actor, id, body.roleCodes);
  }
}
