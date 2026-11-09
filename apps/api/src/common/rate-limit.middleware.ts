import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly redis: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_DISABLED === "true") {
      next();
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || "local";
    const auth = req.path.includes("/auth/login") || req.path.includes("/auth/register");
    const limit = auth ? 10 : 300;
    const allowed = await this.redis.hit(`rl:${ip}:${auth ? "auth" : "api"}`, limit, 60);
    if (!allowed) {
      res.status(429).json({ message: "Слишком много запросов. Подождите минуту.", code: "rate_limit" });
      return;
    }
    next();
  }
}
