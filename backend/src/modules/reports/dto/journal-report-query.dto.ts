import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class JournalReportQueryDto {
  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  journalId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'VALIDATED', 'REVERSED'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 100;
}
