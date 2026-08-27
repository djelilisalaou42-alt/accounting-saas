import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateAccountingEntryLineDto } from './create-accounting-entry-line.dto';

export class CreateAccountingEntryDto {
  @IsDateString()
  entryDate: string;

  @IsString()
  journalId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsString()
  @MaxLength(500)
  label: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'Une écriture doit comporter au moins deux lignes.' })
  @ValidateNested({ each: true })
  @Type(() => CreateAccountingEntryLineDto)
  lines: CreateAccountingEntryLineDto[];
}
