import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTaxDto {
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  country: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label: string;

  @IsOptional()
  @IsIn(['VAT', 'WITHHOLDING', 'OTHER'])
  type?: 'VAT' | 'WITHHOLDING' | 'OTHER';

  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateTaxDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rate?: number;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
