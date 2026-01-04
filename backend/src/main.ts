import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // If you use CORS:
  // app.enableCors({ origin: true, credentials: true });

  const port = Number(process.env.PORT) || 4000;

  await app.listen(port, '0.0.0.0');
  console.log(`API listening on ${port}`);
}

bootstrap();