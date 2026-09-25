import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig, loadLocalEnvFile } from './infrastructure/config.js';
import { configureApp } from './presentation/configure-app.js';

loadLocalEnvFile();
const config = loadConfig();
const app = await NestFactory.create(AppModule.forRoot(config));
configureApp(app, config);
app.enableShutdownHooks();
await app.listen(config.port);
