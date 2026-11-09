import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { FilesService } from "./files.service";

@Controller("files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(@CurrentUser() actor: Actor, @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer; size: number; filename?: string }) {
    return this.files.save(actor, file);
  }

  @Get(":id")
  async download(@CurrentUser() actor: Actor, @Param("id") id: string, @Res() res: Response) {
    const { asset, body } = await this.files.read(actor, id);
    const inline = asset.mime.startsWith("image/") || asset.mime.startsWith("video/") || asset.mime === "application/pdf";
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(asset.filename)}"`);
    res.send(body);
  }
}
