import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const JOURNAL_TYPES = ['SALES', 'PURCHASES', 'CASH', 'BANK', 'GENERAL', 'PAYROLL', 'OPENING', 'CLOSING'] as const;

export class CreateJournalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label: string;

  @IsIn(JOURNAL_TYPES)
  type: (typeof JOURNAL_TYPES)[number];
}

export class UpdateJournalDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label?: string;
}
