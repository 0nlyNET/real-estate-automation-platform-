import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default (configService: ConfigService): TypeOrmModuleOptions => {
  const databaseUrl = configService.get<string>('DATABASE_URL');

  // ===== Hosted / Railway Postgres =====
  if (databaseUrl) {
    const url = new URL(databaseUrl);

    const isLocal =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === 'postgres';

    return {
      type: 'postgres',
      host: url.hostname,
      port: Number(url.port || 5432),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      autoLoadEntities: true,
      synchronize: true, // OK for now
      ssl: isLocal ? false : { rejectUnauthorized: false },
    };
  }

  // ===== Local Postgres (docker / local dev) =====
  const host = configService.get<string>('PGHOST');
  const port = parseInt(configService.get<string>('PGPORT') || '5432', 10);
  const username = configService.get<string>('PGUSER');
  const password = configService.get<string>('PGPASSWORD');
  const database = configService.get<string>('PGDATABASE');

  if (!host || !username || !database) {
    throw new Error(
      'Missing DB config. Set DATABASE_URL (recommended) or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.',
    );
  }

  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    autoLoadEntities: true,
    synchronize: true, // OK for now
    ssl: false,
  };
};

