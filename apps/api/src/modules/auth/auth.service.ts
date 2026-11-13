import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { hash, compare } from "bcryptjs";
import type { Response } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { tr } from "../../common/text";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  hashToken,
  issueAccessToken,
  issueRefreshToken,
  randomId,
  verifyToken,
} from "../../common/tokens";

const EVENTS = ["grade", "deadline", "enrollment", "certificate", "discussion"];

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: { email: string; password: string; firstName: string; lastName: string; locale?: string }) {
    const settings = await this.prisma.setting.findUnique({ where: { key: "allowRegistration" } });
    if (settings && settings.value === false) {
      throw new BadRequestException({ message: "Регистрация закрыта.", code: "registration_closed" });
    }
    const email = input.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException({ message: "Такой email уже зарегистрирован.", code: "email_taken" });
    const student = await this.prisma.role.findUnique({ where: { code: "student" } });
    if (!student) throw new BadRequestException({ message: "Роли ещё не настроены.", code: "not_ready" });
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hash(input.password, 10),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        locale: input.locale === "en" ? "en" : "ru",
        roles: { create: { roleId: student.id } },
        preferences: { create: EVENTS.map((event) => ({ event, inApp: true, email: false })) },
      },
    });
    return user;
  }

  async login(email: string, password: string, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user?.passwordHash || !user.isActive) {
      throw new UnauthorizedException({ message: "Неверный email или пароль.", code: "invalid_credentials" });
    }
    const ok = await compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ message: "Неверный email или пароль.", code: "invalid_credentials" });
    await this.startSession(user.id, res);
    return { ok: true };
  }

  async refresh(token: string | undefined, res: Response) {
    if (!token) throw new UnauthorizedException({ message: "Нет сессии.", code: "unauthorized" });
    const payload = verifyToken(token, process.env.JWT_REFRESH_SECRET || "", "refresh");
    if (!payload?.jti) throw new UnauthorizedException({ message: "Сессия истекла.", code: "unauthorized" });
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
      throw new UnauthorizedException({ message: "Сессия истекла.", code: "unauthorized" });
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    await this.startSession(stored.userId, res);
    return { ok: true };
  }

  async logout(token: string | undefined, res: Response) {
    if (token) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.clearCookies(res);
    return { ok: true };
  }

  async changePassword(actor: Actor, current: string, next: string) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user?.passwordHash) throw new BadRequestException({ message: tr(actor.locale, "Пароль не задан.", "No password is set."), code: "no_password" });
    const ok = await compare(current, user.passwordHash);
    if (!ok) throw new BadRequestException({ message: tr(actor.locale, "Текущий пароль неверный.", "Current password is wrong."), code: "invalid_password" });
    await this.prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hash(next, 10) } });
    return { ok: true };
  }

  googleStart(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new BadRequestException({ message: "Google OAuth не настроен.", code: "oauth_disabled" });
    const state = issueAccessToken("oauth");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", this.redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async googleCallback(code: string, state: string, res: Response) {
    const statePayload = verifyToken(state, process.env.JWT_ACCESS_SECRET || "", "access");
    if (!statePayload || statePayload.sub !== "oauth") {
      throw new BadRequestException({ message: "Некорректный OAuth state.", code: "oauth_state" });
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: this.redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new BadRequestException({ message: "Google не подтвердил вход.", code: "oauth_failed" });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!profileRes.ok) throw new BadRequestException({ message: "Профиль Google недоступен.", code: "oauth_failed" });
    const profile = (await profileRes.json()) as { sub: string; email?: string; given_name?: string; family_name?: string };
    if (!profile.email) throw new BadRequestException({ message: "У аккаунта Google нет email.", code: "oauth_email" });
    const email = profile.email.toLowerCase();
    let user = await this.prisma.user.findFirst({ where: { OR: [{ googleSub: profile.sub }, { email }] } });
    if (!user) {
      const student = await this.prisma.role.findUnique({ where: { code: "student" } });
      if (!student) throw new BadRequestException({ message: "Роли ещё не настроены.", code: "not_ready" });
      user = await this.prisma.user.create({
        data: {
          email,
          googleSub: profile.sub,
          firstName: profile.given_name || "Google",
          lastName: profile.family_name || "User",
          roles: { create: { roleId: student.id } },
          preferences: { create: EVENTS.map((event) => ({ event, inApp: true, email: false })) },
        },
      });
    } else if (!user.googleSub) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { googleSub: profile.sub } });
    }
    if (!user.isActive) throw new UnauthorizedException({ message: "Пользователь недоступен.", code: "unauthorized" });
    await this.startSession(user.id, res);
    return user;
  }

  async startSession(userId: string, res: Response) {
    const jti = randomId();
    const refresh = issueRefreshToken(userId, jti);
    const access = issueAccessToken(userId);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(refresh), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    const secure = process.env.COOKIE_SECURE === "true";
    const common = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
    res.cookie(ACCESS_COOKIE, access, { ...common, maxAge: 15 * 60 * 1000 });
    res.cookie(REFRESH_COOKIE, refresh, { ...common, maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: "/" });
  }

  private redirectUri(): string {
    return `${process.env.API_PUBLIC_URL || "http://localhost:4000"}/api/auth/oauth/google/callback`;
  }
}
