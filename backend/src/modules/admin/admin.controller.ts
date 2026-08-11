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
  Optional,
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
  UsagePolicyDto,
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
import { LimitsService } from '../limits/limits.service';
import { TenantProvisioningService } from '../integrations/tenant-provisioning.service';
import { TwilioProvisioningService } from '../integrations/twilio-provisioning.service';
import { TestingService } from '../testing/testing.service';
import { OffboardingService } from '../offboarding/offboarding.service';

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
    private readonly limits: LimitsService,
    @Optional() private readonly provisioning?: TenantProvisioningService,
    @Optional() private readonly twilioProvisioning?: TwilioProvisioningService,
    @Optional() private readonly testing?: TestingService,
    @Optional() private readonly offboarding?: OffboardingService,
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

  @Get('tenants/:tenantId/usage-policy')
  @UseGuards(PlatformAdminGuard)
  async tenantUsagePolicy(@Param('tenantId') tenantId: string) {
    return this.limits.publicPolicy(
      await this.limits.ensureTenantPolicy(tenantId),
    );
  }

  @Get('tenants/:tenantId/usage-report')
  @UseGuards(PlatformAdminGuard)
  tenantUsageReport(
    @Param('tenantId') tenantId: string,
    @Query('days') days?: string,
  ) {
    return this.limits.tenantUsageReport(tenantId, Number(days || 30));
  }

  @Put('tenants/:tenantId/usage-policy')
  @UseGuards(PlatformAdminGuard)
  updateTenantUsagePolicy(
    @Param('tenantId') tenantId: string,
    @Body() body: UsagePolicyDto,
  ) {
    return this.limits.updateTenantPolicy(tenantId, body);
  }

  @Get('platform-usage-policy')
  @UseGuards(PlatformAdminGuard)
  async platformUsagePolicy() {
    const policy = await this.limits.getPlatformPolicy();
    if (!policy) throw new NotFoundException('Platform usage policy is missing');
    return this.limits.publicPolicy(policy);
  }

  @Put('platform-usage-policy')
  @UseGuards(PlatformAdminGuard)
  updatePlatformUsagePolicy(@Body() body: UsagePolicyDto) {
    return this.limits.updatePlatformPolicy(body);
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

  @Post('tenants/:tenantId/testing')
  @UseGuards(PlatformAdminGuard)
  beginTesting(@Param('tenantId') tenantId: string, @Req() req: any) {
    return this.onboarding.beginTesting(tenantId, req.user.sub);
  }

  @Post('tenants/:tenantId/testing/run')
  @UseGuards(PlatformAdminGuard)
  runControlledTesting(
    @Param('tenantId') tenantId: string,
    @Req() req: any,
    @Body() body: { smsRecipient?: string; emailRecipient?: string },
  ) {
    if (!this.testing) throw new BadRequestException('Testing service unavailable');
    return this.testing.start(tenantId, req.user.sub, body);
  }

  @Get('tenants/:tenantId/testing/runs')
  testingRuns(@Param('tenantId') tenantId: string) {
    if (!this.testing) throw new BadRequestException('Testing service unavailable');
    return this.testing.list(tenantId);
  }

  @Post('tenants/:tenantId/pause')
  @UseGuards(PlatformAdminGuard)
  pause(@Param('tenantId') tenantId: string) {
    return this.onboarding.pause(tenantId);
  }

  @Post('tenants/:tenantId/offboarding')
  @UseGuards(PlatformAdminGuard)
  requestOffboarding(
    @Param('tenantId') tenantId: string,
    @Req() req: any,
    @Body() body: { reason: string; retentionDays?: number },
  ) {
    if (!this.offboarding) throw new BadRequestException('Offboarding service unavailable');
    return this.offboarding.request({
      tenantId,
      reason: body.reason,
      retentionDays: body.retentionDays,
      requestedById: req.user.sub,
    });
  }

  @Get('tenants/:tenantId/offboarding/export')
  @UseGuards(PlatformAdminGuard)
  exportOffboarding(@Param('tenantId') tenantId: string) {
    if (!this.offboarding) throw new BadRequestException('Offboarding service unavailable');
    return this.offboarding.export(tenantId);
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

  @Get('setup-checker')
  @UseGuards(PlatformAdminGuard)
  async setupChecker() {
    const [health, providers] = await Promise.all([
      this.admin.systemHealth(),
      this.platformIntegrations.platformSummary(),
    ]);
    const configured = (name: string) =>
      Boolean(String(process.env[name] || '').trim());
    const item = (
      label: string,
      passed: boolean,
      nextAction: string,
      detail?: unknown,
    ) => ({
      label,
      status: passed ? 'ready' : 'action_required',
      nextAction: passed ? null : nextAction,
      ...(detail === undefined ? {} : { detail }),
    });
    const groups = {
      twilio: [
        item('Parent account connection', providers.twilio.connected, 'Save and test the Twilio parent Account SID and Auth Token.'),
        item('Inbound SMS webhook', configured('TWILIO_WEBHOOK_URL'), 'Configure the public HTTPS Twilio inbound webhook URL.'),
        item('Delivery callback', configured('TWILIO_STATUS_CALLBACK_URL'), 'Configure the public HTTPS Twilio status callback URL.'),
        item('Primary compliance profile', configured('TWILIO_PRIMARY_CUSTOMER_PROFILE_SID'), 'Complete the one-time Twilio primary profile and save its BU SID.'),
        item('Secondary profile policy', configured('TWILIO_SECONDARY_PROFILE_POLICY_SID'), 'Save Twilio’s current Secondary Customer Profile policy SID.'),
        item('A2P trust policy', configured('TWILIO_A2P_TRUST_PRODUCT_POLICY_SID'), 'Save Twilio’s current A2P Trust Product policy SID.'),
      ],
      sendgrid: [
        item('Parent account connection', providers.sendgrid.connected, 'Save and test the SendGrid parent API key.'),
        item('Authenticated sending domain', configured('SENDGRID_SENDING_DOMAIN'), 'Authenticate the sending domain with SPF and DKIM, then configure it.'),
        item('Inbound parse domain', configured('SENDGRID_REPLY_DOMAIN'), 'Configure the unique inbound reply domain.'),
        item('Authenticated inbound webhook', configured('SENDGRID_INBOUND_USERNAME') && configured('SENDGRID_INBOUND_PASSWORD'), 'Configure inbound parse webhook authentication.'),
      ],
      openai: [
        item('API key', configured('OPENAI_API_KEY'), 'Configure the platform OpenAI API key.'),
        item('Model', configured('OPENAI_MODEL'), 'Pin the approved production model.'),
      ],
      stripe: [
        item('Secret key', configured('STRIPE_SECRET_KEY'), 'Configure the Stripe production secret key.'),
        item('Signed webhook', configured('STRIPE_WEBHOOK_SECRET'), 'Configure and verify the Stripe webhook signing secret.'),
        item('Monthly price', configured('STRIPE_PRICE_SERVICE_MONTH'), 'Configure the managed-service monthly price ID.'),
        item('Setup price', configured('STRIPE_PRICE_SETUP_ONCE'), 'Configure the one-time setup price ID.'),
      ],
      database: [
        item('Database connection', health.dbConnected === true, 'Restore the production database connection.'),
        item('Schema synchronization disabled', process.env.TYPEORM_SYNC === 'false', 'Set TYPEORM_SYNC=false and deploy migrations.'),
      ],
      application: [
        item('Integration encryption', health.environment.encryption.status === 'up', 'Configure a protected 32-byte integration encryption key.'),
        item('Public API URL', configured('PUBLIC_API_URL'), 'Configure the public HTTPS API origin.'),
        item('Public app URL', configured('PUBLIC_APP_URL'), 'Configure the public HTTPS application origin.'),
        item('Platform owner', configured('PLATFORM_ADMIN_EMAILS'), 'Configure at least one platform owner email.'),
        item('External uptime monitor', configured('EXTERNAL_UPTIME_MONITOR_URL'), 'Create an external monitor for /health/live and /health/ready, then record its URL.'),
      ],
    };
    const all = Object.values(groups).flat();
    return {
      ready: all.every((entry) => entry.status === 'ready'),
      actionRequired: all.filter((entry) => entry.status !== 'ready').length,
      groups,
      generatedAt: new Date().toISOString(),
    };
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

  @Post('tenants/:tenantId/provisioning/reconcile')
  @UseGuards(PlatformAdminGuard)
  reconcileTenantProvisioning(@Param('tenantId') tenantId: string) {
    if (!this.provisioning) throw new BadRequestException('Provisioning service unavailable');
    return this.provisioning.reconcileTenantProvisioning(tenantId);
  }

  @Patch('tenants/:tenantId/provisioning/twilio-compliance')
  @UseGuards(PlatformAdminGuard)
  async setTwilioCompliance(
    @Param('tenantId') tenantId: string,
    @Body() body: {
      status: 'not_started' | 'pending' | 'approved' | 'blocked';
      customerProfileSid?: string;
      brandSid?: string;
      campaignSid?: string;
    },
  ) {
    if (!['not_started', 'pending', 'approved', 'blocked'].includes(body.status)) {
      throw new BadRequestException('Invalid Twilio compliance status');
    }
    if (!this.twilioProvisioning) {
      throw new BadRequestException('Twilio provisioning service unavailable');
    }
    const resource = await this.twilioProvisioning.setComplianceStatus(tenantId, body.status, body);
    await this.provisioning?.reconcileTenantProvisioning(tenantId);
    return resource;
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
  async testTenantTwilio(
    @Param('tenantId') tenantId: string,
    @Body() body: TestTwilioDto,
  ) {
    const result = await this.platformIntegrations.testTenantTwilio(tenantId, body);
    if (result.ok) await this.provisioning?.reconcileTenantProvisioning(tenantId);
    return result;
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
  async testTenantSendGrid(
    @Param('tenantId') tenantId: string,
    @Body() body: TestSendGridDto,
  ) {
    const result = await this.platformIntegrations.testTenantSendGrid(tenantId, body);
    if (result.ok) await this.provisioning?.reconcileTenantProvisioning(tenantId);
    return result;
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
