import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: { email: string; password: string }) {
    return await this.auth.login(dto.email, dto.password);
  }

  @Post('verify-email')
  async verifyEmail(@Body() dto: { token: string }) {
    return await this.auth.verifyEmail(dto.token);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: { email: string }) {
    return await this.auth.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: { token: string; password: string }) {
    return await this.auth.resetPassword(dto.token, dto.password);
  }
}
