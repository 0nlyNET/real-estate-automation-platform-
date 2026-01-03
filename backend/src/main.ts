import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { ValidationPipe } from "@nestjs/common";
import { json } from "express";
import * as Sentry from "@sentry/node";
import { ConfigService } from "@nestjs/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);

  // ✅ CORS (local + tunnel + production safe)
  const corsOrigins = (configService.get<string>("CORS_ORIGIN") || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // ✅ Optional Sentry
  const sentryDsn = configService.get<string>("SENTRY_DSN");
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: configService.get<string>("NODE_ENV", "development"),
      tracesSampleRate: 0.2,
    });
  }

  // ✅ Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    })
  );

  // ✅ Body size limit
  app.use(json({ limit: "1mb" }));

  // ✅ Global API prefix
  app.setGlobalPrefix("api");

  const port = configService.get<number>("PORT") || 4000;
  await app.listen(port);

  console.log(`🚀 Backend running on port ${port}`);
}

bootstrap();

