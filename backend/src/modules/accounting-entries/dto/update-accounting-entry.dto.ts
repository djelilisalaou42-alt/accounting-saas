import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateAccountingEntryLineDto } from './create-accounting-entry-line.dto';

/**
 * Remplace intégralement les lignes d'une écriture DRAFT (plus simple
 * et plus sûr qu'un patch ligne par ligne pour cette première version
 * du moteur de saisie — une écriture VALIDATED n'atteint de toute
 * façon jamais ce endpoint, voir accounting-entries.service.ts).
 */
export class UpdateAccountingEntryDto {
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  journalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  label?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2, { message: 'Une écriture doit comporter au moins deux lignes.' })
  @ValidateNested({ each: true })
  @Type(() => CreateAccountingEntryLineDto)
  lines?: CreateAccountingEntryLineDto[];
}
