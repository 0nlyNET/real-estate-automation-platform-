import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  @Get()
  async listLeads() {
    // Temporary response so the route compiles and we can verify JWT protection.
    // We will wire this to the real LeadsService after auth is confirmed working.
    return { ok: true, message: 'Leads route is protected by JWT' };
  }
}

