import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Actor } from "./actor";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS = "permissions";
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().user as Actor;
});
