import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator';
import { AUTHOR, SYSTEM_NAME, SYSTEM_VERSION, copyrightLine } from './common/branding';

/** Momento em que ESTE processo arrancou. */
const STARTED_AT = new Date().toISOString();

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
      // Que versão está MESMO no ar, e desde quando: o Render define RENDER_GIT_COMMIT
      // em cada deploy. Sem isto não havia como saber, de fora, se um deploy novo
      // chegou a arrancar ou se continuava a correr o código antigo.
      commit: (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? '').slice(0, 7) || null,
      startedAt: STARTED_AT,
      uptimeSeconds: Math.round(process.uptime()),
      author: AUTHOR,
      copyright: copyrightLine(),
      timestamp: new Date().toISOString(),
    };
  }
}
