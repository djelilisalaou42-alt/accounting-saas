import { IsString, MinLength, MaxLength } from 'class-validator';

export class ReopenAccountingPeriodDto {
  @IsString()
  @MinLength(10, { message: 'Le motif de réouverture doit être suffisamment détaillé (10 caractères minimum).' })
  @MaxLength(500)
  reason: string;
}
