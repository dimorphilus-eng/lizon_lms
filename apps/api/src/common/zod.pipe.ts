import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Проверьте заполненные поля.",
        code: "validation",
        details: parsed.error.flatten(),
      });
    }
    return parsed.data;
  }
}
