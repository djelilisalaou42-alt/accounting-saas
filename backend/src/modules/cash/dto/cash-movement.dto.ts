import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCashMovementDto {
  @IsIn(['RECEIPT', 'DISBURSEMENT'])
  type: 'RECEIPT' | 'DISBURSEMENT';

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

  // Compte de contrepartie — jamais un numéro codé en dur, doit
  // appartenir à l'entreprise, être actif et postable.
  @IsString()
  counterpartAccountId: string;
}

export class CreateCashTransferDto {
  @IsString()
  destinationCashAccountId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  label?: string;
}
