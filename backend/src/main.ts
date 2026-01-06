import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function buildAllowedOrigins(): string[] {
  const defaults = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

  const fromEnv = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const singletons = [
    process.env.FRONTEND_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ].filter(Boolean) as string[];

  const hardcoded = ['https://real-estate-automation-platform.vercel.app'];

  // de-dupe
  return Array.from(new Set([...defaults, ...hardcoded, ...singletons, ...fromEnv]));
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = buildAllowedOrigins();

  app.enableCors({
    origin: (origin, cb) => {
      // allow server-to-server and tools like curl (no Origin header)
      if (!origin) return cb(null, true);

      if (allowedOrigins.includes(origin)) return cb(null, true);

      // Allow any Vercel preview URL for this project if you set FRONTEND_ALLOW_VERCEL_PREVIEWS=true
      if (
        process.env.FRONTEND_ALLOW_VERCEL_PREVIEWS === 'true' &&
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
      ) {
        return cb(null, true);
      }

      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = Number(process.env.PORT) || 4000;

  console.log('BUILD_COMMIT=7938896');
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on ${port}`);
}

bootstrap();
