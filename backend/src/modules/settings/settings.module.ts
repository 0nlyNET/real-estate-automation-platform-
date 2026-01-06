import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from './credential.entity';
import { TenantSettings } from './tenant-settings.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Credential, TenantSettings])],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [TypeOrmModule, SettingsService],
})
export class SettingsModule {}
