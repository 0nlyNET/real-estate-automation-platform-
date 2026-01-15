import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return await this.auth.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return await this.auth.login(dto);
  }

  @Post('verify-email')
  async verifyEmail(@Body() body: { token: string }) {
    return await this.auth.verifyEmail(body?.token || '');
  }
}
