import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { AcceptInvitationDto, ChangeTemporaryPasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto, VerifyEmailDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import {
  clearSessionCookie,
  PRIMARY_SESSION_COOKIE,
  readCookie,
  REMEMBER_ME_MAX_AGE_MS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  setSessionCookie,
} from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const rememberMe = dto.rememberMe === true;
    const result = await this.auth.login(dto.email, dto.password, rememberMe);
    setSessionCookie(
      response,
      result.accessToken,
      SESSION_COOKIE,
      rememberMe ? REMEMBER_ME_MAX_AGE_MS : SESSION_MAX_AGE_MS,
    );
    clearSessionCookie(response, PRIMARY_SESSION_COOKIE);
    return { user: result.user };
  }

  @Post('accept-invitation')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.acceptInvitation(dto.token, dto.password);
    setSessionCookie(response, result.accessToken, SESSION_COOKIE, SESSION_MAX_AGE_MS);
    clearSessionCookie(response, PRIMARY_SESSION_COOKIE);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard)
  async logout(
    @Req() request: Request & { user?: { sub?: string; impersonatedBy?: unknown } },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.user?.sub && !request.user.impersonatedBy) {
      await this.auth.revokeSession(request.user.sub);
    }
    clearSessionCookie(response);
    clearSessionCookie(response, PRIMARY_SESSION_COOKIE);
    return { ok: true };
  }

  @Post('stop-impersonation')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  stopImpersonation(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const primary = readCookie(request, PRIMARY_SESSION_COOKIE);
    if (!primary) {
      clearSessionCookie(response);
      return { ok: false, restored: false };
    }
    setSessionCookie(response, primary, SESSION_COOKIE);
    clearSessionCookie(response, PRIMARY_SESSION_COOKIE);
    return { ok: true, restored: true };
  }

  @Post('change-temporary-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changeTemporaryPassword(@Body() dto: ChangeTemporaryPasswordDto) {
    return this.auth.changeTemporaryPassword(
      dto.email,
      dto.temporaryPassword,
      dto.newPassword,
    );
  }

  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return await this.auth.verifyEmail(dto.token);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.auth.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.auth.resetPassword(dto.token, dto.password);
  }
}
