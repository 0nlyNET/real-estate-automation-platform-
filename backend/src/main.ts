import "dotenv/config";
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { assertProductionEnvironment } from './common/environment-readiness';
import { operationalEvent } from './common/operational-log';

async function bootstrap() {
  assertProductionEnvironment();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const httpLogger = new Logger('HttpRequest');

  app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
    const supplied = String(request.header('x-request-id') || '');
    const requestId = /^[A-Za-z0-9_-]{8,100}$/.test(supplied)
      ? supplied
      : randomUUID();
    const startedAt = Date.now();
    response.setHeader('x-request-id', requestId);
    response.on('finish', () => {
      httpLogger.log(
        operationalEvent('http_request', {
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    });
    next();
  });

  // Needed for Twilio inbound webhooks (application/x-www-form-urlencoded)
  app.use(express.urlencoded({ extended: false }));

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
