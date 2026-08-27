import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string; // RCCM

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxIdNumber?: string; // IFU

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country: string; // code ISO 2 lettres, ex: BJ, CI, SN

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string; // défaut XOF si omis

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
