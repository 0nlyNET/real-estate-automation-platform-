import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CreateClientDto, ImpersonateDto } from './admin.dto';
import { AuditService } from '../audit/audit.service';

@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  async overview() {
    return this.admin.overview();
  }

  @Get('system-health')
  async systemHealth() {
    return this.admin.systemHealth();
  }

  @Get('tenants')
  async listTenants() {
    const items = await this.admin.listTenants();
    return items.map((t: any) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  @Post('tenants')
  async createTenant(@Body() body: CreateClientDto, @Req() req: any) {
    const result = await this.admin.createClient({
      businessName: body.businessName,
      ownerEmail: body.ownerEmail,
    });

    await this.audit.record({
      tenantId: result.tenant.id,
      actorId: String(req.user?.sub || ''),
      actorEmail: String(req.user?.email || ''),
      action: 'client.created',
      method: 'POST',
      path: '/admin/tenants',
      statusCode: 201,
      metadata: {
        ownerUserId: result.owner.id,
        ownerEmail: result.owner.email,
        verificationEmailSent: result.verificationEmailSent,
      },
    });

    return result;
  }

  @Get('tenants/:tenantId/users')
  async listTenantUsers(@Param('tenantId') tenantId: string) {
    const items = await this.admin.listUsersByTenant(tenantId);
    return items.map((u: any) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      tenantId: u.tenantId,
      isActive: u.isActive,
    }));
  }

  @Post('impersonate')
  async impersonate(@Body() body: ImpersonateDto, @Req() req: any) {
    const userId = String(body?.userId || '').trim();
    if (!userId) throw new BadRequestException('Missing userId');

    const target = await this.admin.findUserById(userId);
    if (!target) throw new NotFoundException('User not found');
    if (!target.isActive || !target.isEmailVerified || !target.tenantId) {
      throw new ForbiddenException('Target account is inactive or unverified');
    }

    const actorId = String(req.user?.sub || '');
    const actorEmail = String(req.user?.email || '');
    const token = this.auth.signForImpersonation(target, {
      id: actorId,
      email: actorEmail,
    });

    await this.audit.record({
      tenantId: target.tenantId,
      actorId,
      actorEmail,
      action: 'support.impersonation.started',
      method: 'POST',
      path: '/admin/impersonate',
      statusCode: 201,
      metadata: {
        subjectUserId: target.id,
        subjectEmail: target.email,
      },
    });

    return {
      accessToken: token,
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        tenantId: target.tenantId,
      },
      impersonatedBy: {
        userId: actorId,
        email: actorEmail,
      },
      expiresInSeconds: 15 * 60,
    };
  }
}
