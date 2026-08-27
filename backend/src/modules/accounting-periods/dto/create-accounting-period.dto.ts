import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAccountingPeriodDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
