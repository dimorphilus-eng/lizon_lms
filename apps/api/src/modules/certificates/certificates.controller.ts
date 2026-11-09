import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { CertificatesService } from "./certificates.service";

@Controller("certificates")
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  list(@CurrentUser() actor: Actor) {
    return this.certificates.list(actor);
  }

  @Get(":id/pdf")
  async pdf(@CurrentUser() actor: Actor, @Param("id") id: string, @Res() res: Response) {
    const file = await this.certificates.pdf(actor, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    res.send(file.bytes);
  }
}
