import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { PublicService } from './public.service';
import { UpdateApplicationDto } from './public.dto';

@Controller('admin/applications')
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
export class AdminApplicationsController {
  constructor(private readonly applications: PublicService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.applications.listApplications(
      status,
      Number(take || 50),
      Number(skip || 0),
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.applications.updateApplication(id, dto as any);
  }

  @Post(':id/onboarding-task')
  onboardingTask(@Param('id') id: string) {
    return this.applications.createOnboardingTask(id);
  }
}
