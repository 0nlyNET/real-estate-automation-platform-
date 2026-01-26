import { Body, Controller, Headers, Post } from '@nestjs/common';
import { AgencyApplicationsService } from './agency-applications.service';
import { CreateAgencyApplicationDto } from './dto/create-agency-application.dto';

@Controller('public')
export class AgencyApplicationsController {
  constructor(private readonly applicationsService: AgencyApplicationsService) {}

  @Post('applications')
  async create(
    @Body() dto: CreateAgencyApplicationDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.applicationsService.create(dto, userAgent);
  }
}
