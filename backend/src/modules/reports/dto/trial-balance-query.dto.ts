import { IsDateString, IsOptional, IsString } from 'class-validator';

export class TrialBalanceQueryDto {
  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  classCode?: string;

  @IsOptional()
  @IsString()
  search?: string; // code ou libellé, préfixe ou exact
}
