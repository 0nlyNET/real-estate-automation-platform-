import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root() {
    return {
      status: 'ok',
      service: 'real-estate-automation-platform',
      uptime: process.uptime(),
    };
  }
}