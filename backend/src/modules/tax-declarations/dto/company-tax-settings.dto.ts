import { IsOptional, IsString } from 'class-validator';

export class UpsertCompanyTaxSettingsDto {
  @IsString()
  taxId: string;

  @IsOptional()
  @IsString()
  collectedAccountId?: string;

  @IsOptional()
  @IsString()
  deductibleAccountId?: string;

  @IsOptional()
  @IsString()
  payableAccountId?: string;
}
