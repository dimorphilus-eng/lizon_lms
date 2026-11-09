import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Actor } from "./actor";
import { IS_PUBLIC, PERMISSIONS } from "./decorators";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;
    const actor = context.switchToHttp().getRequest().user as Actor | undefined;
    if (!actor) return false;
    const allowed = required.every((permission) => actor.permissions.includes(permission));
    if (!allowed) throw new ForbiddenException({ message: "Недостаточно прав.", code: "forbidden" });
    return true;
  }
}
