import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SalesBookingService } from './sales-booking.service';

class SaveSalesBookingDto {
  @IsString()
  bookingUrl!: string;
}

@Controller('public/sales-booking')
export class PublicSalesBookingController {
  constructor(private readonly salesBooking: SalesBookingService) {}

  @Get()
  summary() {
    return this.salesBooking.publicSummary();
  }
}

@UseGuards(JwtAuthGuard, PlatformOperatorGuard, PlatformAdminGuard)
@Controller('admin/sales-booking')
export class AdminSalesBookingController {
  constructor(private readonly salesBooking: SalesBookingService) {}

  @Get()
  summary() {
    return this.salesBooking.summary();
  }

  @Put()
  save(@Body() body: SaveSalesBookingDto) {
    return this.salesBooking.save(body.bookingUrl);
  }

  @Delete()
  remove() {
    return this.salesBooking.remove();
  }
}
