import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRole('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Req() request: any,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.audit.listForTenant(
      request.user.tenantId,
      Number.parseInt(take || '100', 10) || 100,
      Number.parseInt(skip || '0', 10) || 0,
    );
  }
}
