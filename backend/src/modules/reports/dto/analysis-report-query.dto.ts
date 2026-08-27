import { IsOptional, IsString } from 'class-validator';

/** Filtre de période commun — mêmes règles de résolution que Balance/Grand Livre (Étape 8) :
 * priorité à periodId, puis dates explicites, puis exercice OPEN par défaut. */
export class DateRangeReportQueryDto {
  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class ComparativeReportQueryDto extends DateRangeReportQueryDto {
  @IsOptional()
  @IsString()
  comparePeriodId?: string;
}

export class BudgetReportQueryDto {
  @IsOptional()
  @IsString()
  budgetId?: string;

  @IsOptional()
  @IsString()
  periodId?: string;
}

export class TaxReportQueryDto {
  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
