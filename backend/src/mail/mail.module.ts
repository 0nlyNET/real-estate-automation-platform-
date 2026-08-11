import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { PlatformCredential } from '../modules/integrations/platform-credential.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformCredential])],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
