import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  app.enableCors({
    origin: [frontend],
    credentials: true,
  });

  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${port}`);
}
bootstrap();
