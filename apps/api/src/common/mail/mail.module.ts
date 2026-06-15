import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailAdminController } from './mail.controller';

@Global()
@Module({
  controllers: [MailAdminController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
