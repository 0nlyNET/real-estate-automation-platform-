import { Controller, Get, Query } from '@nestjs/common';
import { ComplianceService } from './compliance.service';

@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  unsubscribe(@Query('token') token: string) {
    return this.compliance.unsubscribeEmail(token);
  }
}
