import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/rbac';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateAppointmentDto,
  CreateHandoffDto,
  UpdateAppointmentDto,
  UpdateHandoffDto,
} from './client-operations.dto';
import { ClientOperationsService } from './client-operations.service';

@Controller('client')
@UseGuards(JwtAuthGuard)
export class ClientOperationsController {
  constructor(private readonly operations: ClientOperationsService) {}

  @Get('today')
  today(@Req() req: any, @Query('limit') limit?: string) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return this.operations.getToday(
      tenantId,
      { userId: req.user?.sub, role: req.user?.role as UserRole },
      Number(limit || 8),
    );
  }

  @Patch('handoffs/:id')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  updateHandoff(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateHandoffDto,
  ) {
    return this.operations.updateHandoff(
      id,
      req.user?.tenantId,
      body,
      { userId: req.user?.sub, role: req.user?.role as UserRole },
    );
  }

  @Post('handoffs')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  createHandoff(@Req() req: any, @Body() body: CreateHandoffDto) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return this.operations.requestHandoff(
      tenantId,
      body.leadId,
      body.reason,
      { userId: req.user?.sub, role: req.user?.role as UserRole },
    );
  }

  @Get('appointments')
  appointments(@Req() req: any, @Query('status') status?: string) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return this.operations.listAppointments(
      tenantId,
      { userId: req.user?.sub, role: req.user?.role as UserRole },
      status,
    );
  }

  @Post('appointments')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  createAppointment(@Req() req: any, @Body() body: CreateAppointmentDto) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return this.operations.createAppointment(
      tenantId,
      body,
      { userId: req.user?.sub, role: req.user?.role as UserRole },
    );
  }

  @Patch('appointments/:id')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  updateAppointment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateAppointmentDto,
  ) {
    return this.operations.updateAppointment(
      id,
      req.user?.tenantId,
      body,
      { userId: req.user?.sub, role: req.user?.role as UserRole },
    );
  }
}

@Controller('admin/client-operations')
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
export class AdminClientOperationsController {
  constructor(private readonly operations: ClientOperationsService) {}

  @Get('today')
  today(@Query('tenantId') tenantId?: string) {
    if (!tenantId) throw new ForbiddenException('Choose a client workspace');
    return this.operations.getToday(tenantId, undefined, 8);
  }

  @Get('handoffs')
  handoffs(
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ) {
    return this.operations.listHandoffsForAdmin({
      tenantId,
      status,
      take: Number(take || 100),
    });
  }

  @Patch('handoffs/:id')
  updateHandoff(@Param('id') id: string, @Body() body: UpdateHandoffDto) {
    return this.operations.updateHandoff(id, null, body);
  }

  @Get('appointments')
  appointments(
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ) {
    return this.operations.listAppointmentsForAdmin({
      tenantId,
      status,
      take: Number(take || 100),
    });
  }

  @Patch('appointments/:id')
  updateAppointment(@Param('id') id: string, @Body() body: UpdateAppointmentDto) {
    return this.operations.updateAppointment(id, null, body);
  }
}
