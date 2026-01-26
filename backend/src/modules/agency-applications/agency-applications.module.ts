import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyApplication } from './agency-application.entity';
import { AgencyApplicationsController } from './agency-applications.controller';
import { AgencyApplicationsService } from './agency-applications.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgencyApplication])],
  controllers: [AgencyApplicationsController],
  providers: [AgencyApplicationsService],
})
export class AgencyApplicationsModule {}
