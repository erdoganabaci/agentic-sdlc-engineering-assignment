import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadConfig, loadLocalEnvFile } from './infrastructure/config.js';
import { configureApp } from './presentation/configure-app.js';

async function bootstrap(): Promise<void> {
  loadLocalEnvFile();
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config));
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  Logger.error(error, 'Bootstrap');
  process.exit(1);
});
