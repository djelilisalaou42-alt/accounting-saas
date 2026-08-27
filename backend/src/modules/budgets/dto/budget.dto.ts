import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateBudgetDto {
  @IsString()
  periodId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateBudgetLineDto {
  @IsString()
  accountId: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsNumber()
  plannedAmount: number;
}

export class UpdateBudgetLineDto {
  @IsNumber()
  plannedAmount: number;
}

export class ListBudgetsDto {
  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'CLOSED'])
  status?: string;
}
