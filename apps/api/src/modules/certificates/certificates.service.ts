import { readFile } from "fs/promises";
import path from "path";
import { Injectable } from "@nestjs/common";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PrismaService } from "../../prisma/prisma.service";
import type { Actor } from "../../common/actor";
import { PolicyService } from "../access/policy.service";

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  list(actor: Actor) {
    return this.prisma.certificate.findMany({
      where: actor.permissions.includes("courses.manage") ? {} : { userId: actor.id },
      include: { course: { select: { title: true, language: true } }, user: { select: { firstName: true, lastName: true } } },
      orderBy: { issuedAt: "desc" },
    });
  }

  async pdf(actor: Actor, id: string) {
    const certificate = await this.prisma.certificate.findUnique({ include: { course: true, user: true }, where: { id } });
    if (!certificate) this.policy.missing(actor);
    if (certificate.userId !== actor.id && !actor.permissions.includes("courses.manage") && !actor.permissions.includes("certificates.issue")) {
      this.policy.forbid(actor);
    }
    const bytes = await this.render(certificate.user.firstName + " " + certificate.user.lastName, certificate.course.title, certificate.code, certificate.issuedAt, certificate.course.language);
    return { filename: `${certificate.code}.pdf`, bytes };
  }

  private async render(name: string, course: string, code: string, issuedAt: Date, language: string) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const regular = await pdf.embedFont(await readFile(path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf")), { subset: true });
    const bold = await pdf.embedFont(await readFile(path.join(process.cwd(), "assets/fonts/NotoSans-SemiBold.ttf")), { subset: true });
    const page = pdf.addPage([842, 595]);
    const ink = rgb(0.13, 0.11, 0.09);
    const accent = rgb(0.76, 0.3, 0.2);
    page.drawRectangle({ x: 28, y: 28, width: 786, height: 539, borderColor: accent, borderWidth: 2 });
    page.drawRectangle({ x: 40, y: 40, width: 762, height: 515, borderColor: rgb(0.83, 0.75, 0.66), borderWidth: 1 });
    const en = language === "en";
    page.drawText("LIZON", { x: 70, y: 470, size: 14, font: bold, color: accent });
    page.drawText(en ? "Certificate of completion" : "Сертификат о прохождении", { x: 70, y: 420, size: 32, font: bold, color: ink });
    page.drawText(en ? "This confirms that" : "Подтверждает, что", { x: 70, y: 360, size: 14, font: regular, color: rgb(0.4, 0.35, 0.3) });
    page.drawText(clip(name, 42), { x: 70, y: 320, size: 28, font: bold, color: ink });
    page.drawText(en ? "has completed the course" : "завершил(а) курс", { x: 70, y: 270, size: 14, font: regular, color: rgb(0.4, 0.35, 0.3) });
    page.drawText(clip(course, 48), { x: 70, y: 230, size: 22, font: bold, color: ink });
    const date = issuedAt.toLocaleDateString(en ? "en-GB" : "ru-RU");
    page.drawText(en ? `Issued ${date}` : `Выдан ${date}`, { x: 70, y: 140, size: 12, font: regular, color: ink });
    page.drawText(code, { x: 70, y: 110, size: 12, font: bold, color: accent });
    return Buffer.from(await pdf.save());
  }
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
