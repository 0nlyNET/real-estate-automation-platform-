import { Body, Controller, Post } from '@nestjs/common';
import { PublicInquiryDto } from './public.dto';
import { PublicService } from './public.service';
import { Throttle } from '@nestjs/throttler';

@Controller('public')
export class PublicController {
  constructor(private readonly pub: PublicService) {}

  @Post('inquiry')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async inquiry(@Body() dto: PublicInquiryDto) {
    const email = (dto.email || '').toString().trim().toLowerCase();
    const name = dto.name ? String(dto.name).trim() : undefined;
    const company = dto.company ? String(dto.company).trim() : undefined;
    const topic = dto.topic ? String(dto.topic).trim().toLowerCase() : 'sales';
    const message = (dto.message || '').toString().trim();
    const source = dto.source ? String(dto.source).trim() : undefined;

    return await this.pub.submitInquiry({ email, name, company, topic, message, source });
  }
}
