import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateBankMovementDto {
  @IsIn(['CREDIT', 'DEBIT'])
  type: 'CREDIT' | 'DEBIT';

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  transactionDate: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsString()
  counterpartAccountId: string;
}

export class CreateBankTransferDto {
  @IsString()
  destinationBankAccountId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  label?: string;
}
