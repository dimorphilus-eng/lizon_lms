import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "./actor";
import { IS_PUBLIC } from "./decorators";
import { ACCESS_COOKIE, verifyToken } from "./tokens";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = bearer || request.cookies?.[ACCESS_COOKIE];
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException({ message: "Нужно войти.", code: "unauthorized" });
    }
    const payload = verifyToken(token, process.env.JWT_ACCESS_SECRET || "", "access");
    if (!payload) {
      if (isPublic) return true;
      throw new UnauthorizedException({ message: "Сессия истекла.", code: "unauthorized" });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException({ message: "Пользователь недоступен.", code: "unauthorized" });
    const roles = user.roles.map((item) => item.role.code);
    const permissions = [...new Set(user.roles.flatMap((item) => item.role.permissions.map((row) => row.permission.code)))];
    const actor: Actor = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      locale: user.locale,
      theme: user.theme,
      accent: user.accent,
      roles,
      permissions,
      customFields: user.customFields,
    };
    request.user = actor;
    return true;
  }
}
