import { Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { PricingRequestService } from './application/pricing-request.service.js';
import { PricingStore } from './application/pricing-store.js';
import { PrismaClient } from './generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from './infrastructure/config.js';
import { createPrismaClient } from './infrastructure/prisma-client.js';
import { PrismaPricingStore } from './infrastructure/prisma-pricing-store.js';
import { AppController } from './presentation/app.controller.js';
import { ActorGuard } from './presentation/auth.js';
import { RequestsController } from './presentation/requests.controller.js';

@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient) {}

  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AppController, RequestsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PrismaClient, useFactory: () => createPrismaClient(config.databaseUrl) },
        {
          provide: PricingStore,
          useFactory: (prisma: PrismaClient) => new PrismaPricingStore(prisma, prisma),
          inject: [PrismaClient],
        },
        {
          provide: PricingRequestService,
          useFactory: (store: PricingStore) => new PricingRequestService(store),
          inject: [PricingStore],
        },
        ActorGuard,
      ],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
