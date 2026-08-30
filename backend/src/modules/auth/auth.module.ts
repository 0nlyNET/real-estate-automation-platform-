import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetToken } from './password-reset-token.entity';
import { AccountInvitation } from './account-invitation.entity';

import { UsersModule } from '../users/users.module';
import { MailModule } from '../../mail/mail.module';
import { requireJwtSecret } from '../../common/env';
import { AuditModule } from '../audit/audit.module';
import { JWT_SIGN_OPTIONS } from './auth-token';

@Module({
  imports: [
    UsersModule,
    MailModule,
    AuditModule,
    TypeOrmModule.forFeature([PasswordResetToken, AccountInvitation]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret(),
        signOptions: JWT_SIGN_OPTIONS,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
