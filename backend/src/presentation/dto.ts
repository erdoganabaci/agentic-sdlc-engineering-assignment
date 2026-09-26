import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { DecisionOutcome, RequestStatus } from '../domain/pricing-request.js';

const OUTCOMES: DecisionOutcome[] = ['APPROVED', 'DECLINED'];
const STATUSES: RequestStatus[] = ['PENDING', 'APPROVED', 'DECLINED'];

class VersionContentDto {
  @ApiProperty({ example: 25, description: 'Whole basis points; must be above 0 and below the standard rate.' })
  @IsInt()
  discountBps: number;

  @ApiProperty({ example: 'Competing offer from another lender.', description: '1-1000 characters after trimming.' })
  @IsString()
  reason: string;
}

export class CreateRequestDto extends VersionContentDto {
  @ApiProperty({ example: 'APP-100' })
  @IsString()
  @Length(1, 64)
  applicationId: string;
}

export class ReviseRequestDto extends VersionContentDto {
  @ApiProperty({ example: 1, description: 'Current version number shown to the caller.' })
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiProperty({ example: 1, description: 'rowRevision shown to the caller.' })
  @IsInt()
  @Min(0)
  expectedRevision: number;
}

export class DecisionDto {
  @ApiProperty({ example: 0, description: 'rowRevision shown to the reviewer.' })
  @IsInt()
  @Min(0)
  expectedRevision: number;

  @ApiProperty({ enum: OUTCOMES, example: 'APPROVED' })
  @IsIn(OUTCOMES)
  outcome: DecisionOutcome;

  @ApiPropertyOptional({ example: 'Within policy.', description: 'Required when declining; max 1000 characters.' })
  // Omitted is allowed; explicit null is not (IsOptional would let null through to the domain).
  @ValidateIf((_dto: DecisionDto, comment: unknown) => comment !== undefined)
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ListRequestsQuery {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: RequestStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 'STALE_REVISION' })
  code: string;

  @ApiProperty({ example: 'The request changed since it was loaded. Reload it and try again.' })
  message: string;

  @ApiProperty({ example: '0b6f1c1e-2d0a-4a53-9a55-4f5b3a3f9c11' })
  correlationId: string;
}
