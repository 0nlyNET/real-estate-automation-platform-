import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { ValidationPipe } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // CORS (keep simple for now; you can tighten later)
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ✅ Railway provides PORT dynamically
  const port = parseInt(process.env.PORT || "4000", 10);

  // ✅ Bind to 0.0.0.0 so Railway can reach it
  await app.listen(port, "0.0.0.0");

  console.log(`API listening on ${port}`);
}

bootstrap();