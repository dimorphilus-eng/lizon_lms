import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { QuestionValidationError, explainValidation } from "@lizon/shared";

@Catch()
export class HttpFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (exception instanceof QuestionValidationError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: explainValidation(exception.code, "ru"),
        code: exception.code,
      });
      return;
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(typeof body === "string" ? { message: body } : body);
      return;
    }
    const prismaCode = typeof exception === "object" && exception && "code" in exception ? String(exception.code) : "";
    if (prismaCode === "P2002") {
      response.status(HttpStatus.CONFLICT).json({ message: "Такая запись уже есть.", code: "conflict" });
      return;
    }
    console.error(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Внутренняя ошибка.", code: "internal" });
  }
}
