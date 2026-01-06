import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Rate limit auth endpoints to reduce brute force.
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  register(
    @Body()
    body: { email: string; password: string; brokerage?: string; fullName?: string },
  ) {
    // fullName is accepted for frontend UX, but not persisted in MVP schema yet.
    return this.authService.register({
      email: body.email,
      password: body.password,
      brokerage: body.brokerage,
    });
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  forgotPassword(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword({ token: body.token, newPassword: body.newPassword });
  }
}
