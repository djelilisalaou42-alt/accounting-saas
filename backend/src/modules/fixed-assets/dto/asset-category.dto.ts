import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class CreateAssetCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  // Comptes du référentiel — jamais un numéro codé en dur, doivent
  // appartenir à l'entreprise et être des comptes réels du plan
  // comptable configuré (voir validateAssetAccount du service).
  @IsString()
  assetAccountId: string;

  @IsString()
  depreciationAccountId: string;

  @IsString()
  depreciationExpenseAccountId: string;

  @IsOptional()
  @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE'])
  defaultMethod?: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

  @IsInt()
  @Min(1)
  defaultUsefulLifeYears: number;
}

export class UpdateAssetCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  assetAccountId?: string;

  @IsOptional()
  @IsString()
  depreciationAccountId?: string;

  @IsOptional()
  @IsString()
  depreciationExpenseAccountId?: string;

  @IsOptional()
  @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE'])
  defaultMethod?: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultUsefulLifeYears?: number;
}
