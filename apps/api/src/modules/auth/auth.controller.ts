import { Body, Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { CurrentUser, Public } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { REFRESH_COOKIE } from "../../common/tokens";
import { ZodPipe } from "../../common/zod.pipe";
import { AuthService } from "./auth.service";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  locale: z.enum(["ru", "en"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(8).max(200),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  async register(
    @Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.register(body);
    await this.auth.startSession(user.id, res);
    return { ok: true };
  }

  @Public()
  @Post("login")
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body.email, body.password, res);
  }

  @Public()
  @Post("refresh")
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.[REFRESH_COOKIE], res);
  }

  @Public()
  @Post("logout")
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req.cookies?.[REFRESH_COOKIE], res);
  }

  @Get("me")
  me(@CurrentUser() actor: Actor) {
    return actor;
  }

  @Post("password")
  password(@CurrentUser() actor: Actor, @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    return this.auth.changePassword(actor, body.current, body.next);
  }

  @Public()
  @Get("oauth/google")
  google(@Res() res: Response) {
    res.redirect(this.auth.googleStart());
  }

  @Public()
  @Get("oauth/google/callback")
  async googleCallback(@Query("code") code: string, @Query("state") state: string, @Res() res: Response) {
    await this.auth.googleCallback(code, state, res);
    res.redirect(`${process.env.WEB_ORIGIN || "http://localhost:3000"}/learn`);
  }
}
