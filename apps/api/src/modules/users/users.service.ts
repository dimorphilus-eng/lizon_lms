import { BadRequestException, Injectable } from "@nestjs/common";
import { hash } from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { canEditUserRoles } from "../../common/actor";
import { tr } from "../../common/text";

const EVENTS = ["grade", "deadline", "enrollment", "certificate", "discussion"];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: string | undefined, take: number, skip: number) {
    const where = query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" as const } },
            { firstName: { contains: query, mode: "insensitive" as const } },
            { lastName: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: "desc" },
        include: { roles: { include: { role: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      total,
      items: items.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale,
        isActive: user.isActive,
        customFields: user.customFields,
        roles: user.roles.map((item) => item.role.code),
      })),
    };
  }

  async create(actor: Actor, input: { email: string; password: string; firstName: string; lastName: string; roleCodes: string[] }) {
    if (!canEditUserRoles(actor, [], input.roleCodes)) {
      throw new BadRequestException({ message: tr(actor.locale, "Нельзя назначить эту роль.", "This role cannot be assigned."), code: "forbidden" });
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: input.roleCodes } } });
    if (roles.length !== input.roleCodes.length) {
      throw new BadRequestException({ message: tr(actor.locale, "Неизвестная роль.", "Unknown role."), code: "role" });
    }
    const user = await this.prisma.user.create({
      data: {
        email: input.email.trim().toLowerCase(),
        passwordHash: await hash(input.password, 10),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        roles: { create: roles.map((role) => ({ roleId: role.id })) },
        preferences: { create: EVENTS.map((event) => ({ event, inApp: true, email: false })) },
      },
    });
    return { id: user.id };
  }

  async update(actor: Actor, id: string, input: { firstName?: string; lastName?: string; locale?: string; theme?: string; accent?: string | null; isActive?: boolean; customFields?: Record<string, unknown> }) {
    if (actor.id !== id && !actor.permissions.includes("users.manage")) {
      throw new BadRequestException({ message: tr(actor.locale, "Недостаточно прав.", "You do not have permission."), code: "forbidden" });
    }
    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName.trim();
    if (input.lastName !== undefined) data.lastName = input.lastName.trim();
    if (input.locale !== undefined) data.locale = input.locale;
    if (input.theme !== undefined) data.theme = input.theme;
    if (input.accent !== undefined) data.accent = input.accent;
    if (input.customFields !== undefined) data.customFields = input.customFields;
    if (input.isActive !== undefined) {
      if (!actor.permissions.includes("users.manage")) {
        throw new BadRequestException({ message: tr(actor.locale, "Недостаточно прав.", "You do not have permission."), code: "forbidden" });
      }
      data.isActive = input.isActive;
    }
    await this.prisma.user.update({ where: { id }, data });
    return { ok: true };
  }

  async setRoles(actor: Actor, id: string, roleCodes: string[]) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
    if (!target) throw new BadRequestException({ message: "Пользователь не найден.", code: "not_found" });
    const current = target.roles.map((item) => item.role.code);
    if (!canEditUserRoles(actor, current, roleCodes)) {
      throw new BadRequestException({ message: tr(actor.locale, "Нельзя изменить эту роль.", "This role cannot be changed."), code: "forbidden" });
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: roleCodes } } });
    if (roles.length !== new Set(roleCodes).size) throw new BadRequestException({ message: "Неизвестная роль.", code: "role" });
    await this.prisma.userRole.deleteMany({ where: { userId: id } });
    await this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })) });
    return { ok: true };
  }
}
