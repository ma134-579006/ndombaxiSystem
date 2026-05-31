import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator';
import { AUTHOR, SYSTEM_NAME, SYSTEM_VERSION, copyrightLine } from './common/branding';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  check() {
    return {
      status: 'ok',
      system: SYSTEM_NAME,
      service: 'ndombaxi-api',
      version: SYSTEM_VERSION,
      author: AUTHOR,
      copyright: copyrightLine(),
      timestamp: new Date().toISOString(),
    };
  }
}
