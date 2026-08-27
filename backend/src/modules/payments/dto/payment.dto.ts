import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class PaymentAllocationDto {
  @IsString()
  invoiceId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class CreatePaymentDto {
  @IsIn(['INCOMING', 'OUTGOING'])
  direction: 'INCOMING' | 'OUTGOING';

  @IsIn(['CASH', 'BANK_TRANSFER', 'CHECK', 'MOBILE_MONEY', 'CARD', 'OTHER'])
  method: 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'MOBILE_MONEY' | 'CARD' | 'OTHER';

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsDateString()
  paymentDate: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Compte de trésorerie (caisse ou banque) — l'un des deux, jamais un
  // numéro de compte codé en dur.
  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  // Affectation aux factures (Phase 10) — peut rester vide (paiement
  // non affecté immédiatement) ou couvrir une ou plusieurs factures.
  @IsOptional()
  @IsArray()
  @ArrayUnique((a: PaymentAllocationDto) => a.invoiceId)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}

export class UpdatePaymentDto {
  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
