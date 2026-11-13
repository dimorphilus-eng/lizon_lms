import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AuthGuard } from "./common/auth.guard";
import { PermissionsGuard } from "./common/permissions.guard";
import { ClientHeaderGuard } from "./common/header.guard";
import { RateLimitMiddleware } from "./common/rate-limit.middleware";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { RbacModule } from "./modules/rbac/rbac.module";
import { AccessModule } from "./modules/access/access.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { CoursesModule } from "./modules/courses/courses.module";
import { QuestionsModule } from "./modules/questions/questions.module";
import { QuizzesModule } from "./modules/quizzes/quizzes.module";
import { AssignmentsModule } from "./modules/assignments/assignments.module";
import { DiscussionsModule } from "./modules/discussions/discussions.module";
import { FilesModule } from "./modules/files/files.module";
import { CertificatesModule } from "./modules/certificates/certificates.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { AdminModule } from "./modules/admin/admin.module";
import { registerScalePlugin } from "./plugins/scale";

registerScalePlugin();

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    NotificationsModule,
    AccessModule,
    AuthModule,
    UsersModule,
    RbacModule,
    CoursesModule,
    QuestionsModule,
    QuizzesModule,
    AssignmentsModule,
    DiscussionsModule,
    FilesModule,
    CertificatesModule,
    DashboardModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ClientHeaderGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
