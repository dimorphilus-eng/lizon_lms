import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { tr } from "../../common/text";

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  permissions() {
    return this.prisma.permission.findMany({ orderBy: { code: "asc" } });
  }

  roles() {
    return this.prisma.role.findMany({
      orderBy: { code: "asc" },
      include: { permissions: { include: { permission: true } } },
    }).then((roles) =>
      roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions.map((item) => item.permission.code),
      })),
    );
  }

  async create(actor: Actor, input: { code: string; name: string; description?: string; permissions: string[] }) {
    const permissions = await this.lookup(input.permissions);
    const role = await this.prisma.role.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? "",
        permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
    });
    return { id: role.id };
  }

  async update(actor: Actor, id: string, input: { name?: string; description?: string; permissions?: string[] }) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new BadRequestException({ message: tr(actor.locale, "Роль не найдена.", "Role not found."), code: "not_found" });
    if (role.code === "admin" && !actor.roles.includes("admin")) {
      throw new BadRequestException({ message: tr(actor.locale, "Роль администратора нельзя менять.", "The admin role cannot be edited."), code: "forbidden" });
    }
    await this.prisma.role.update({
      where: { id },
      data: { name: input.name, description: input.description },
    });
    if (input.permissions) {
      const permissions = await this.lookup(input.permissions);
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      await this.prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id })) });
    }
    return { ok: true };
  }

  async remove(actor: Actor, id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new BadRequestException({ message: "Роль не найдена.", code: "not_found" });
    if (role.isSystem) throw new BadRequestException({ message: tr(actor.locale, "Системную роль нельзя удалить.", "A system role cannot be deleted."), code: "system_role" });
    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }

  private async lookup(codes: string[]) {
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: codes } } });
    if (permissions.length !== new Set(codes).size) {
      throw new BadRequestException({ message: "Неизвестное право.", code: "permission" });
    }
    return permissions;
  }
}
