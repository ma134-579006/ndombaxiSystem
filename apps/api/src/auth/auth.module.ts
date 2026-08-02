import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TwoFaService } from './twofa.service';
import { TokenService } from './token.service';
import { GoogleAuthService } from './google-auth.service';
import { OfflineCredentialsService } from './offline-credentials.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TwoFaService,
    TokenService,
    GoogleAuthService,
    OfflineCredentialsService,
    JwtStrategy,
  ],
  exports: [AuthService, PasswordService, TokenService, GoogleAuthService, OfflineCredentialsService],
})
export class AuthModule {}
