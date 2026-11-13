import { Global, Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SecurityAdminController, TwoFactorController } from './security.controller';
import { TwoFactorService } from './two-factor.service';

/** Verificação em 2 passos (global: login, recuperação e troca de senha de todo o sistema). */
@Global()
@Module({
  imports: [IntegrationsModule],
  controllers: [SecurityAdminController, TwoFactorController],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class SecurityModule {}
