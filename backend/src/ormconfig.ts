import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get('PGHOST'),
  port: parseInt(configService.get('PGPORT') || '5432', 10),
  username: configService.get('PGUSER'),
  password: configService.get('PGPASSWORD'),
  database: configService.get('PGDATABASE'),
  autoLoadEntities: true,
  synchronize: true, // OK for now, turn off later
  ssl: {
    rejectUnauthorized: false,
  },
});