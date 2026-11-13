import { BadRequestException, Injectable } from "@nestjs/common";
import path from "path";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { PolicyService } from "../access/policy.service";
import { createStorage } from "./storage";

const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "text/plain",
  "text/markdown",
]);

@Injectable()
export class FilesService {
  private readonly storage = createStorage();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async save(actor: Actor, file: { originalname: string; mimetype: string; buffer: Buffer; size: number; filename?: string } | undefined) {
    if (!file) throw new BadRequestException({ message: "Файл не приложен.", code: "file" });
    if (!ALLOWED.has(file.mimetype)) throw new BadRequestException({ message: "Этот тип файла не принимается.", code: "mime" });
    const filename = path.basename(file.originalname).replace(/[^\w.\- ()\u0400-\u04FF]+/g, "_").slice(0, 120) || "file";
    const key = `${new Date().getUTCFullYear()}/${file.filename || Date.now()}-${filename}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.prisma.fileAsset.create({
      data: { ownerId: actor.id, storageKey: key, filename, mime: file.mimetype, size: file.size },
    });
  }

  async read(actor: Actor, id: string) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!asset) this.policy.missing(actor);
    if (asset.ownerId !== actor.id && !actor.permissions.includes("courses.manage")) {
      const enrolled = await this.prisma.enrollment.findFirst({ where: { userId: actor.id, status: "active" } });
      if (!enrolled && !actor.permissions.includes("content.author")) this.policy.forbid(actor);
    }
    const body = await this.storage.get(asset.storageKey);
    return { asset, body };
  }
}
