import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

interface TokenPayload {
  sub: string;
  type: "access" | "refresh";
  jti?: string;
  exp: number;
}

function sign(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyToken(token: string, secret: string, type: TokenPayload["type"]): TokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (payload.type !== type || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueAccessToken(userId: string): string {
  const secret = requiredSecret("JWT_ACCESS_SECRET");
  return sign({ sub: userId, type: "access", exp: Math.floor(Date.now() / 1000) + 15 * 60 }, secret);
}

export function issueRefreshToken(userId: string, jti: string): string {
  const secret = requiredSecret("JWT_REFRESH_SECRET");
  return sign({ sub: userId, type: "refresh", jti, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 }, secret);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomId(): string {
  return randomBytes(18).toString("hex");
}

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const ACCESS_COOKIE = "lizon_access";
export const REFRESH_COOKIE = "lizon_refresh";
