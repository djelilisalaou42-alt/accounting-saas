import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const NATURE_VALUES = ['DEBIT', 'CREDIT', 'BOTH'] as const;

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  // Volontairement aucune contrainte de longueur fixe (ex: pas de
  // "code.length === 6") — un plan comptable peut légitimement mélanger
  // des niveaux de détail différents (1, 10, 101, 1011, 101100...),
  // voir REVUE-ETAPE-6.md.
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label: string;

  @IsString()
  accountClassId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsIn(NATURE_VALUES)
  nature?: (typeof NATURE_VALUES)[number];

  @IsOptional()
  @IsBoolean()
  isAuxiliary?: boolean;

  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
