import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PricingRequestService } from '../application/pricing-request.service.js';
import type { User } from '../domain/pricing-request.js';
import { CurrentActor, RequireRoles } from './auth.js';
import { CreateRequestDto, DecisionDto, ErrorResponseDto, ListRequestsQuery, ReviseRequestDto } from './dto.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function requireIdempotencyKey(key: string | undefined): string {
  if (key && IDEMPOTENCY_KEY_PATTERN.test(key)) return key;
  throw new BadRequestException('Idempotency-Key header is required: 8-128 letters, digits, "-" or "_".');
}

const errorDoc = (description: string) => ({ type: ErrorResponseDto, description });

@ApiTags('requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly service: PricingRequestService) {}

  @Post()
  @RequireRoles('MANAGER')
  @ApiOperation({ summary: 'Create the pricing request for an assigned application' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Reuse on retry; same key + payload replays.' })
  @ApiCreatedResponse({
    schema: { example: { requestId: '5f2c…', applicationId: 'APP-100', versionNumber: 1, rowRevision: 0 } },
  })
  @ApiBadRequestResponse(errorDoc('Invalid input or missing Idempotency-Key.'))
  @ApiNotFoundResponse(errorDoc('Application unknown or not assigned to the manager.'))
  @ApiConflictResponse(errorDoc('REQUEST_EXISTS or IDEMPOTENCY_KEY_REUSED.'))
  async create(
    @CurrentActor() actor: User,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateRequestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const stored = await this.service.createRequest(actor, requireIdempotencyKey(idempotencyKey), body);
    response.status(stored.status);
    return stored.body;
  }

  @Get()
  @RequireRoles('MANAGER', 'REVIEWER')
  @ApiOperation({ summary: 'List visible requests (managers: own applications; reviewers: all)' })
  list(@CurrentActor() actor: User, @Query() query: ListRequestsQuery) {
    return this.service.listRequests(actor, query);
  }

  @Get(':id')
  @RequireRoles('MANAGER', 'REVIEWER')
  @ApiOperation({ summary: 'Request details with every version and decision' })
  @ApiNotFoundResponse(errorDoc('Unknown or not visible to the actor.'))
  get(@CurrentActor() actor: User, @Param('id') requestId: string) {
    return this.service.getRequest(actor, requestId);
  }

  @Post(':id/versions')
  @RequireRoles('MANAGER')
  @ApiOperation({ summary: 'Revise: creates a new pending version; any earlier approval becomes unusable' })
  @ApiCreatedResponse({ schema: { example: { requestId: '5f2c…', versionNumber: 2, rowRevision: 2 } } })
  @ApiBadRequestResponse(errorDoc('Invalid input or NO_CHANGE.'))
  @ApiConflictResponse(errorDoc('STALE_REVISION: reload and retry.'))
  revise(@CurrentActor() actor: User, @Param('id') requestId: string, @Body() body: ReviseRequestDto) {
    const { expectedVersion, expectedRevision, discountBps, reason } = body;
    return this.service.reviseRequest(actor, requestId, { expectedVersion, expectedRevision }, { discountBps, reason });
  }

  @Post(':id/versions/:version/decision')
  @HttpCode(200)
  @RequireRoles('REVIEWER')
  @ApiOperation({ summary: 'Approve or decline exactly this version (must be current and undecided)' })
  @ApiOkResponse({
    schema: {
      example: { requestId: '5f2c…', versionNumber: 1, decisionId: '9a1d…', outcome: 'APPROVED', rowRevision: 1 },
    },
  })
  @ApiBadRequestResponse(errorDoc('Invalid input, e.g. declining without a comment.'))
  @ApiConflictResponse(errorDoc('VERSION_NOT_CURRENT, ALREADY_DECIDED or STALE_REVISION.'))
  decide(
    @CurrentActor() actor: User,
    @Param('id') requestId: string,
    @Param('version', ParseIntPipe) versionNumber: number,
    @Body() body: DecisionDto,
  ) {
    return this.service.decide(actor, requestId, versionNumber, body);
  }

  @Get(':id/approved-discount')
  @RequireRoles('SYSTEM')
  @ApiOperation({ summary: 'Usable discount for mortgage processing: only an approved current version' })
  @ApiOkResponse({
    schema: {
      example: {
        applicationId: 'APP-103',
        requestId: 'REQ-103',
        versionNumber: 1,
        decisionId: 'DEC-103-1',
        discountBps: 30,
        reviewerId: 'noah',
        decidedAt: '2026-01-08T12:00:00.000Z',
      },
    },
  })
  @ApiConflictResponse(errorDoc('NO_CURRENT_APPROVAL: current version pending or declined.'))
  approvedDiscount(@Param('id') requestId: string) {
    return this.service.approvedDiscount(requestId);
  }
}
