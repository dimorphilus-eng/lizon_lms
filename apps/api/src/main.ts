import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import helmet from "helmet";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "./app.module";
import { HttpFilter } from "./common/http.filter";
import { registerScalePlugin } from "./plugins/scale";

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix("api");
  // Moodle XML банка — один JSON-документ, стандартные 100 КБ его режут.
  app.use(json({ limit: "12mb" }));
  app.use(urlencoded({ extended: true, limit: "12mb" }));
  app.use(cookieParser());
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.enableCors({
    origin: (process.env.WEB_ORIGIN || "http://localhost:3000").split(","),
    credentials: true,
  });
  app.useGlobalFilters(new HttpFilter());
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", 1);
}

async function bootstrap() {
  registerScalePlugin();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  await app.listen(process.env.PORT || 4000);
}

if (require.main === module) {
  void bootstrap();
}
