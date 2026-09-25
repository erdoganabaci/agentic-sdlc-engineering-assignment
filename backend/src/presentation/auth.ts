import {
  applyDecorators,
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse, ApiHeader, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { PricingRequestService } from '../application/pricing-request.service.js';
import type { Role, User } from '../domain/pricing-request.js';
import { APP_CONFIG, type AppConfig } from '../infrastructure/config.js';
import { ErrorResponseDto } from './dto.js';

type ActorRequest = Request & { actor?: User };

const AllowedRoles = Reflector.createDecorator<Role[]>();

/**
 * Local demo identity: X-User-Id is resolved to a seeded user on the server.
 * Replace this guard with verified OIDC/JWT identity before any public deployment.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly service: PricingRequestService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.isDemoAuthEnabled) throw new UnauthorizedException('No authentication method is configured.');
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const userId = request.header('x-user-id');
    const actor = userId ? await this.service.findUser(userId) : null;
    if (!actor) throw new UnauthorizedException('Missing or unknown X-User-Id.');
    const roles = this.reflector.get(AllowedRoles, context.getHandler());
    if (!roles.includes(actor.role)) throw new ForbiddenException(`Role ${actor.role} cannot perform this action.`);
    request.actor = actor;
    return true;
  }
}

export function RequireRoles(...roles: Role[]) {
  return applyDecorators(
    AllowedRoles(roles),
    UseGuards(ActorGuard),
    ApiHeader({
      name: 'X-User-Id',
      required: true,
      description: `Local demo identity. Allowed roles: ${roles.join(', ')}.`,
    }),
    ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Missing or unknown identity.' }),
    ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Role not permitted.' }),
  );
}

export const CurrentActor = createParamDecorator((_: unknown, context: ExecutionContext): User => {
  const { actor } = context.switchToHttp().getRequest<ActorRequest>();
  if (!actor) throw new UnauthorizedException('Route is missing RequireRoles.');
  return actor;
});
