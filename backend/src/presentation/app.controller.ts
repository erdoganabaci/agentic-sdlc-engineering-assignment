import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PricingRequestService } from '../application/pricing-request.service.js';
import type { MortgageApplication, User } from '../domain/pricing-request.js';
import { APP_CONFIG, type AppConfig } from '../infrastructure/config.js';
import { CurrentActor, RequireRoles } from './auth.js';

@ApiTags('general')
@Controller()
export class AppController {
  constructor(
    private readonly service: PricingRequestService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  health() {
    return { status: 'ok' };
  }

  @Get('demo/users')
  @ApiOperation({ summary: 'Seeded identities for the demo user picker (demo mode only)' })
  @ApiOkResponse({ schema: { example: [{ id: 'ali', name: 'Ali', role: 'MANAGER' }] } })
  demoUsers(): Promise<User[]> {
    if (!this.config.isDemoAuthEnabled) throw new NotFoundException('Demo mode is disabled.');
    return this.service.listUsers();
  }

  @Get('applications')
  @RequireRoles('MANAGER', 'REVIEWER')
  @ApiOperation({ summary: 'Applications visible to the actor (managers: assigned only)' })
  @ApiOkResponse({
    schema: {
      example: [
        {
          id: 'APP-100',
          customerLabel: 'Synthetic customer A',
          managerId: 'ali',
          standardRateBps: 400,
          requestId: null,
        },
      ],
    },
  })
  applications(@CurrentActor() actor: User): Promise<MortgageApplication[]> {
    return this.service.listApplications(actor);
  }
}
