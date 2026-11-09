import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Нестандартный заголовок нельзя выставить простой HTML-формой с чужого сайта. */
@Injectable()
export class ClientHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (SAFE.has(request.method)) return true;
    if (request.headers["x-requested-with"] === "lizon") return true;
    throw new ForbiddenException({ message: "Запрос отклонён.", code: "csrf" });
  }
}
