import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SequencesService } from './sequences.service';

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

  @UseGuards(JwtAuthGuard)
  @Patch('sequences/:id')
  update(@Req() req: any, @Param('id') id: string, @Body() payload: any) {
    return this.sequencesService.updateSequence(req.user?.tenantId, id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('sequences/:id/toggle')
  toggle(@Req() req: any, @Param('id') id: string) {
    return this.sequencesService.toggleSequence(req.user?.tenantId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sequences')
  create(@Req() req: any, @Body() payload: any) {
    return this.sequencesService.createSequence(req.user?.tenantId, payload);
  }

  // Step management (minimal, for in-app editor)
  @UseGuards(JwtAuthGuard)
  @Post('sequences/:id/steps')
  addStep(@Req() req: any, @Param('id') id: string, @Body() payload: any) {
    return this.sequencesService.addStep(req.user?.tenantId, id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('sequences/:id/steps/:stepId')
  updateStep(
    @Req() req: any,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() payload: any,
  ) {
    return this.sequencesService.updateStep(req.user?.tenantId, id, stepId, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sequences/:id/steps/:stepId')
  deleteStep(@Req() req: any, @Param('id') id: string, @Param('stepId') stepId: string) {
    return this.sequencesService.deleteStep(req.user?.tenantId, id, stepId);
  }

  // Lead-level controls (pause/resume/stop)
  @UseGuards(JwtAuthGuard)
  @Get('leads/:leadId/enrollments')
  listEnrollments(@Req() req: any, @Param('leadId') leadId: string) {
    return this.sequencesService.listEnrollmentsForLead(req.user?.tenantId, leadId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leads/:leadId/enrollments/:enrollmentId/pause')
  pause(@Req() req: any, @Param('leadId') leadId: string, @Param('enrollmentId') enrollmentId: string) {
    return this.sequencesService.pauseEnrollment(req.user?.tenantId, leadId, enrollmentId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leads/:leadId/enrollments/:enrollmentId/resume')
  resume(@Req() req: any, @Param('leadId') leadId: string, @Param('enrollmentId') enrollmentId: string) {
    return this.sequencesService.resumeEnrollment(req.user?.tenantId, leadId, enrollmentId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leads/:leadId/enrollments/:enrollmentId/stop')
  stop(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() payload: any,
  ) {
    return this.sequencesService.stopEnrollment(req.user?.tenantId, leadId, enrollmentId, payload?.reason || 'manual');
  }
}
