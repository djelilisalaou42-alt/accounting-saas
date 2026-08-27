import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCashAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  // Compte comptable associé — doit être un compte de trésorerie
  // (classe 5) réellement configuré dans le plan comptable de
  // l'entreprise, jamais un numéro codé en dur.
  @IsString()
  accountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateCashAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
