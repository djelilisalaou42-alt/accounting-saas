import { IsDateString, IsNumber, IsString } from 'class-validator';

export class CreateReconciliationDto {
  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsNumber()
  statementBalance: number;
}

export class MatchLinesDto {
  @IsString()
  statementTransactionId: string;

  @IsString()
  bookTransactionId: string;
}

export class ImportStatementDto {
  @IsString()
  csvContent: string;
}
