import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('register')
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
}
