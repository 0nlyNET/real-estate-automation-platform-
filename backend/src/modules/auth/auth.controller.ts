import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: { email: string; password: string; tenantName?: string; fullName?: string; brokerage?: string }) {
    return await this.auth.register(dto);
  }

  @Post('login')
  async login(@Body() dto: { email: string; password: string }) {
    return await this.auth.login(dto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return await this.auth.forgotPassword(body?.email || '');
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    return await this.auth.resetPassword(body?.token || '', body?.password || '');
  }
}
