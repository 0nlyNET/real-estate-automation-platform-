import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProspectApplication } from './prospect-application.entity';
import { MailModule } from '../../mail/mail.module';
import { AdminApplicationsController } from './admin-applications.controller';
import { CommonModule } from '../../common/common.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProspectApplication]),
    MailModule,
    CommonModule,
    AdminModule,
  ],
  controllers: [PublicController, AdminApplicationsController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
