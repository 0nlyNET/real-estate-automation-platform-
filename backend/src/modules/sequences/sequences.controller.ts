import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SequencesService } from './sequences.service';
import { CreateSequenceDto, SequenceStepDto, StopEnrollmentDto, UpdateSequenceDto } from './sequences.dto';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';

@Controller()
export class SequencesController {
  constructor(private readonly sequencesService: SequencesService) {}

  @UseGuards(JwtAuthGuard)
  @Get('sequences')
  list(@Req() req: any) {
    return this.sequencesService.listSequences(req.user?.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sequences/:id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.sequencesService.getSequence(req.user?.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch('sequences/:id')
  @RequireRole('admin')
  update(@Req() req: any, @Param('id') id: string, @Body() payload: UpdateSequenceDto) {
    return this.sequencesService.updateSequence(req.user?.tenantId, id, payload);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch('sequences/:id/toggle')
  @RequireRole('admin')
  toggle(@Req() req: any, @Param('id') id: string) {
    return this.sequencesService.toggleSequence(req.user?.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('sequences')
  @RequireRole('admin')
  create(@Req() req: any, @Body() payload: CreateSequenceDto) {
    return this.sequencesService.createSequence(req.user?.tenantId, payload);
  }

  // Step management (minimal, for in-app editor)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('sequences/:id/steps')
  @RequireRole('admin')
  addStep(@Req() req: any, @Param('id') id: string, @Body() payload: SequenceStepDto) {
    return this.sequencesService.addStep(req.user?.tenantId, id, payload);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch('sequences/:id/steps/:stepId')
  @RequireRole('admin')
  updateStep(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() payload: SequenceStepDto,
  ) {
    return this.sequencesService.updateStep(req.user?.tenantId, id, stepId, payload);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete('sequences/:id/steps/:stepId')
  @RequireRole('admin')
  deleteStep(@Req() req: any, @Param('id') id: string, @Param('stepId') stepId: string) {
    return this.sequencesService.deleteStep(req.user?.tenantId, id, stepId);
  }

  // Lead-level controls (pause/resume/stop)
  @UseGuards(JwtAuthGuard)
  @Get('leads/:leadId/enrollments')
  listEnrollments(@Req() req: any, @Param('leadId') leadId: string) {
    return this.sequencesService.listEnrollmentsForLead(req.user?.tenantId, leadId, {
      userId: req.user?.sub,
      role: req.user?.role,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('leads/:leadId/enrollments/:enrollmentId/pause')
  @RequireRole('tc')
  pause(@Req() req: any, @Param('leadId') leadId: string, @Param('enrollmentId') enrollmentId: string) {
    return this.sequencesService.pauseEnrollment(req.user?.tenantId, leadId, enrollmentId, { userId: req.user?.sub, role: req.user?.role });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('leads/:leadId/enrollments/:enrollmentId/resume')
  @RequireRole('tc')
  resume(@Req() req: any, @Param('leadId') leadId: string, @Param('enrollmentId') enrollmentId: string) {
    return this.sequencesService.resumeEnrollment(req.user?.tenantId, leadId, enrollmentId, { userId: req.user?.sub, role: req.user?.role });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('leads/:leadId/enrollments/:enrollmentId/stop')
  @RequireRole('tc')
  stop(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() payload: StopEnrollmentDto,
  ) {
    return this.sequencesService.stopEnrollment(req.user?.tenantId, leadId, enrollmentId, payload?.reason || 'manual', { userId: req.user?.sub, role: req.user?.role });
  }
}
