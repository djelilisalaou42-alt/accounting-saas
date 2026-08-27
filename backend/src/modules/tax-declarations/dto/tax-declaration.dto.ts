import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class CreateTaxDeclarationDto {
  @IsString()
  taxId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  periodLabel: string;

  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsDateString()
  dueDate: string;
}

export class RecordTaxPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  paymentDate: string;
}

export class ListTaxDeclarationsDto {
  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'SUBMITTED', 'PAID', 'LATE'])
  status?: string;
}
