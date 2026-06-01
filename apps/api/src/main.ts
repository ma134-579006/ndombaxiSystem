import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  app.use(helmet());

  // CORS: aceita a lista explícita do env (CORS_ORIGINS) E, por conveniência,
  // qualquer subdomínio de plataformas de deploy grátis (Cloudflare Pages /
  // Vercel / Netlify) — assim não é preciso reconfigurar a cada novo deploy.
  // Pedidos sem Origin (curl, apps mobile) são sempre permitidos.
  const allowList = config.get('CORS_ORIGINS', { infer: true }) as string[];
  const allowHostSuffixes = ['.pages.dev', '.vercel.app', '.netlify.app'];
  app.enableCors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      try {
        const host = new URL(origin).hostname;
        if (allowHostSuffixes.some((suf) => host.endsWith(suf))) {
          return callback(null, true);
        }
      } catch {
        /* origin malformado → rejeitar abaixo */
      }
      return callback(new Error(`Origin não permitida por CORS: ${origin}`), false);
    },
  });

  const prefix = config.get('API_PREFIX', { infer: true });
  if (prefix) app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ndombaxi System API')
      .setDescription('Core API — multi-tenant, auth, RBAC, POS/ERP/e-commerce (AGT)')
      .setVersion('3.0.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(prefix ? `${prefix}/docs` : 'docs', app, doc);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`Ndombaxi System API em http://localhost:${port}${prefix ? '/' + prefix : ''}`);
}

void bootstrap();
