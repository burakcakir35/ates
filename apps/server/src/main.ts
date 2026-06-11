import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`ATES game server (play-money) listening on :${port}`, 'Bootstrap');
}

void bootstrap();
