import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from '../settings/credential.entity';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { CommonModule } from '../../common/common.module';
import { OperationsModule } from '../operations/operations.module';
import { PlatformCredential } from './platform-credential.entity';
import { PlatformIntegrationsService } from './platform-integrations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential, PlatformCredential]),
    CommonModule,
    OperationsModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, PlatformIntegrationsService],
  exports: [IntegrationsService, PlatformIntegrationsService],
})
export class IntegrationsModule {}
