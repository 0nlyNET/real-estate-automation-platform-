import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import {
  AssignClientDto,
  CreateClientDto,
  ImpersonateDto,
  SetPlatformStaffDto,
  SuspendClientServicesDto,
} from './admin.dto';
import { AuditService } from '../audit/audit.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OperatorOnboardingEvidenceDto } from '../onboarding/onboarding.dto';
import {
  PRIMARY_SESSION_COOKIE,
  readCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth/session-cookie';
import { describeServiceState, ServiceControlService } from '../service-control/service-control.service';
import { PlatformIntegrationsService } from '../integrations/platform-integrations.service';
import {
  AssignManagedSendGridDto,
  AssignManagedTwilioDto,
  PlatformSendGridDto,
  PlatformTwilioDto,
  TestPlatformSendGridDto,
  TestPlatformTwilioDto,
  TestSendGridDto,
  TestTwilioDto,
} from '../integrations/integrations.dto';
import type { ManagedMessagingProvider } from '../integrations/platform-integrations.service';

@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly onboarding: OnboardingService,
    private readonly serviceControl: ServiceControlService,
    private readonly platformIntegrations: PlatformIntegrationsService,
  ) {}

  @Get('overview')
  async overview(@Req() req: any) {
    return this.admin.overview(req.user?.platformRole === 'super_admin');
  }

  @Get('lead-attention')
  leadAttention(@Query('take') take?: string) {
    return this.admin.leadAttention(Number(take || 50));
  }

  @Get('tenants/:tenantId/readiness')
  readiness(@Param('tenantId') tenantId: string) {
    return this.onboarding.readiness(tenantId);
  }

  @Post('tenants/:tenantId/onboarding-evidence')
  onboardingEvidence(
    @Param('tenantId') tenantId: string,
    @Body() body: OperatorOnboardingEvidenceDto,
    @Req() req: any,
  ) {
    if (body.billingVerifiedAt && req.user?.platformRole !== 'super_admin') {
      throw new ForbiddenException('Only the owner can verify client billing');
    }
    return this.onboarding.recordOperatorEvidence(
      tenantId,
      body,
      req.user.sub,
    );
  }

  @Post('tenants/:tenantId/activate')
  @UseGuards(PlatformAdminGuard)
  activate(@Param('tenantId') tenantId: string, @Req() req: any) {
    return this.onboarding.activate(tenantId, req.user.sub);
  }

  @Post('tenants/:tenantId/pause')
  @UseGuards(PlatformAdminGuard)
  pause(@Param('tenantId') tenantId: string) {
    return this.onboarding.pause(tenantId);
  }

  @Post('tenants/:tenantId/suspend')
  @UseGuards(PlatformAdminGuard)
  suspendServices(
    @Param('tenantId') tenantId: string,
    @Body() body: SuspendClientServicesDto,
    @Req() req: any,
  ) {
    return this.serviceControl.suspend({
      tenantId,
      reason: body.reason,
      source: 'manual',
      actor: {
        id: String(req.user?.sub || ''),
        email: String(req.user?.email || ''),
      },
    });
  }

  @Post('tenants/:tenantId/restore')
  @UseGuards(PlatformAdminGuard)
  restoreServices(@Param('tenantId') tenantId: string, @Req() req: any) {
    return this.serviceControl.restore({
      tenantId,
      actor: {
        id: String(req.user?.sub || ''),
        email: String(req.user?.email || ''),
      },
    });
  }

  @Get('system-health')
  @UseGuards(PlatformAdminGuard)
  async systemHealth() {
    return this.admin.systemHealth();
  }

  @Get('tenants')
  async listTenants(@Req() req: any) {
    const financialAccess = req.user?.platformRole === 'super_admin';
    const items = await this.admin.listTenants();
    return items.map((t: any) => {
      const fullServiceState = describeServiceState(t);
      const serviceState = financialAccess
        ? fullServiceState
        : ['payment_overdue', 'grace_period'].includes(fullServiceState.state)
          ? {
              state: 'paused',
              label: 'Owner action required',
              reason: 'The platform owner is handling this service status.',
              graceEndsAt: null,
            }
          : fullServiceState.state === 'suspended'
            ? {
                ...fullServiceState,
                reason: 'Services are stopped. Contact the platform owner for details.',
                graceEndsAt: null,
              }
            : fullServiceState;
      return {
        id: t.id,
        name: t.name,
        ...(financialAccess ? { status: t.status } : {}),
        lifecycleStatus: t.lifecycleStatus,
        serviceState,
        assignedOperatorId: t.assignedOperatorId || null,
        ...(financialAccess
          ? {
              currentPeriodEnd: t.currentPeriodEnd || null,
              lastPaymentFailureAt: t.lastPaymentFailureAt || null,
              serviceSuspendedAt: t.serviceSuspendedAt || null,
              serviceSuspensionReason: t.serviceSuspensionReason || null,
              serviceSuspensionSource: t.serviceSuspensionSource || null,
              serviceSuspendedById: t.serviceSuspendedById || null,
              serviceRestoredAt: t.serviceRestoredAt || null,
              serviceRestoredById: t.serviceRestoredById || null,
            }
          : {}),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });
  }

  @Post('tenants')
  @UseGuards(PlatformAdminGuard)
  async createTenant(@Body() body: CreateClientDto, @Req() req: any) {
    const result = await this.admin.createClient({
      businessName: body.businessName,
      ownerEmail: body.ownerEmail,
      assignedOperatorId: body.assignedOperatorId,
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

  @Get('operators')
  operators() {
    return this.admin.listOperators();
  }

  @Get('platform-access')
  @UseGuards(PlatformAdminGuard)
  platformAccess(@Req() req: any) {
    return this.admin.platformAccessUsers(req.user.tenantId);
  }

  @Patch('platform-access/:userId')
  @UseGuards(PlatformAdminGuard)
  setPlatformAccess(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: SetPlatformStaffDto,
  ) {
    return this.admin.setPlatformStaff(req.user.tenantId, userId, body.enabled);
  }

  @Patch('tenants/:tenantId/assignment')
  @UseGuards(PlatformAdminGuard)
  assignClient(
    @Param('tenantId') tenantId: string,
    @Body() body: AssignClientDto,
  ) {
    return this.admin.assignClient(tenantId, body.assignedOperatorId);
  }

  @Get('billing-overview')
  @UseGuards(PlatformAdminGuard)
  billingOverview() {
    return this.admin.financialOverview();
  }

  @Get('reporting-overview')
  reportingOverview(@Req() req: any) {
    return this.admin.businessReport(req.user?.platformRole === 'super_admin');
  }

  @Get('communications')
  communications(
    @Query('tenantId') tenantId?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.admin.communications({
      tenantId,
      channel,
      status,
      take: Number(take || 50),
      skip: Number(skip || 0),
    });
  }

  @Get('integrations-overview')
  integrationsOverview() {
    return this.admin.integrationOverview();
  }

  @Get('platform-integrations')
  @UseGuards(PlatformAdminGuard)
  platformIntegrationSummary() {
    return this.platformIntegrations.platformSummary();
  }

  @Put('platform-integrations/twilio')
  @UseGuards(PlatformAdminGuard)
  savePlatformTwilio(@Body() body: PlatformTwilioDto) {
    return this.platformIntegrations.savePlatformTwilio(body);
  }

  @Post('platform-integrations/twilio/test')
  @UseGuards(PlatformAdminGuard)
  testPlatformTwilio(@Body() body: TestPlatformTwilioDto) {
    return this.platformIntegrations.testPlatformTwilio(body);
  }

  @Put('platform-integrations/sendgrid')
  @UseGuards(PlatformAdminGuard)
  savePlatformSendGrid(@Body() body: PlatformSendGridDto) {
    return this.platformIntegrations.savePlatformSendGrid(body);
  }

  @Post('platform-integrations/sendgrid/test')
  @UseGuards(PlatformAdminGuard)
  testPlatformSendGrid(@Body() body: TestPlatformSendGridDto) {
    return this.platformIntegrations.testPlatformSendGrid(body);
  }

  @Delete('platform-integrations/:provider')
  @UseGuards(PlatformAdminGuard)
  removePlatformProvider(@Param('provider') provider: string) {
    if (provider !== 'twilio' && provider !== 'sendgrid') {
      throw new BadRequestException('Unsupported managed provider');
    }
    return this.platformIntegrations.removePlatformProvider(
      provider as ManagedMessagingProvider,
    );
  }

  @Get('tenants/:tenantId/integrations')
  tenantIntegrations(@Param('tenantId') tenantId: string) {
    return this.platformIntegrations.tenantSummary(tenantId);
  }

  @Put('tenants/:tenantId/integrations/twilio')
  @UseGuards(PlatformAdminGuard)
  assignTenantTwilio(
    @Param('tenantId') tenantId: string,
    @Body() body: AssignManagedTwilioDto,
  ) {
    return this.platformIntegrations.assignTwilio(tenantId, body);
  }

  @Post('tenants/:tenantId/integrations/twilio/test')
  @UseGuards(PlatformAdminGuard)
  testTenantTwilio(
    @Param('tenantId') tenantId: string,
    @Body() body: TestTwilioDto,
  ) {
    return this.platformIntegrations.testTenantTwilio(tenantId, body);
  }

  @Put('tenants/:tenantId/integrations/sendgrid')
  @UseGuards(PlatformAdminGuard)
  assignTenantSendGrid(
    @Param('tenantId') tenantId: string,
    @Body() body: AssignManagedSendGridDto,
  ) {
    return this.platformIntegrations.assignSendGrid(tenantId, body);
  }

  @Post('tenants/:tenantId/integrations/sendgrid/test')
  @UseGuards(PlatformAdminGuard)
  testTenantSendGrid(
    @Param('tenantId') tenantId: string,
    @Body() body: TestSendGridDto,
  ) {
    return this.platformIntegrations.testTenantSendGrid(tenantId, body);
  }

  @Delete('tenants/:tenantId/integrations/:provider')
  @UseGuards(PlatformAdminGuard)
  removeTenantProvider(
    @Param('tenantId') tenantId: string,
    @Param('provider') provider: string,
  ) {
    if (provider !== 'twilio' && provider !== 'sendgrid') {
      throw new BadRequestException('Unsupported managed provider');
    }
    return this.platformIntegrations.removeTenantProvider(
      tenantId,
      provider as ManagedMessagingProvider,
    );
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
  @UseGuards(PlatformAdminGuard)
  async impersonate(
    @Body() body: ImpersonateDto,
    @Req() req: Request & { user?: any },
    @Res({ passthrough: true }) response: Response,
  ) {
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
    const primary =
      readCookie(req, PRIMARY_SESSION_COOKIE) || readCookie(req, SESSION_COOKIE);
    if (!primary) throw new ForbiddenException('Primary admin session is unavailable');
    setSessionCookie(response, primary, PRIMARY_SESSION_COOKIE);
    setSessionCookie(response, token, SESSION_COOKIE, 15 * 60 * 1000);

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
