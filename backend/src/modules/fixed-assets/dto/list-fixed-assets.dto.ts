import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListFixedAssetsDto {
  @IsOptional()
  @IsString()
  search?: string; // code, libellé

  @IsOptional()
  @IsIn(['ACQUIRED', 'IN_SERVICE', 'UNDER_MAINTENANCE', 'DISPOSED', 'FULLY_DEPRECIATED'])
  status?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
