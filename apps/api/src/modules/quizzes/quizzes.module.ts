import { Module } from "@nestjs/common";
import { CoursesModule } from "../courses/courses.module";
import { QuizzesController } from "./quizzes.controller";
import { QuizzesService } from "./quizzes.service";

@Module({ imports: [CoursesModule], controllers: [QuizzesController], providers: [QuizzesService] })
export class QuizzesModule {}
