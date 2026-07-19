import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { OnboardingService } from './onboarding.service';
import { UpdateOnboardingDto } from './onboarding.dto';

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  get(@Req() req: any) {
    return this.onboarding.getOrCreate(req.user.tenantId);
  }

  @Get('readiness')
  readiness(@Req() req: any) {
    return this.onboarding.readiness(req.user.tenantId);
  }

  @Put()
  @UseGuards(RolesGuard)
  @RequireRole('admin')
  update(@Req() req: any, @Body() dto: UpdateOnboardingDto) {
    return this.onboarding.updateClientInput(req.user.tenantId, dto);
  }
}
