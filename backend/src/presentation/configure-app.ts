import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../infrastructure/config.js';
import { CORRELATION_HEADER, ErrorFilter } from './error.filter.js';

const CORRELATION_PATTERN = /^[\w-]{1,100}$/;

function assignCorrelationId(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header(CORRELATION_HEADER);
  response.setHeader(CORRELATION_HEADER, incoming && CORRELATION_PATTERN.test(incoming) ? incoming : randomUUID());
  next();
}

/** Shared by main.ts and the API tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.enableCors({ origin: config.corsOrigin, exposedHeaders: [CORRELATION_HEADER] });
  app.use(assignCorrelationId);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Mortgage pricing exceptions')
      .setDescription(
        'Versioned discount requests with reviewer approval. Local demo identity via X-User-Id; ' +
          'errors are { code, message, correlationId }.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
}
