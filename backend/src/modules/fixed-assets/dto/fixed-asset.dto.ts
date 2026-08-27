import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class CreateFixedAssetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  // Compte d'immobilisation — hérité de la catégorie si omis, mais peut
  // être fourni explicitement pour corriger un cas particulier (jamais
  // un numéro codé en dur).
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
  @IsString()
  supplierId?: string;

  // Facture d'origine — si renseignée, l'écriture d'acquisition a déjà
  // été comptabilisée par le module invoices (Étape 10) et ne sera
  // jamais générée une seconde fois par ce module.
  @IsOptional()
  @IsString()
  invoiceId?: string;

  // Compte de contrepartie (fournisseur ou trésorerie) — requis
  // uniquement lorsqu'aucune facture n'est liée : c'est alors ce
  // module qui génère l'écriture d'acquisition (jamais un numéro
  // codé en dur). Ignoré si invoiceId est fourni (l'écriture existe
  // déjà côté module invoices, Étape 10).
  @IsOptional()
  @IsString()
  counterpartAccountId?: string;

  @IsDateString()
  acquisitionDate: string;

  @IsNumber()
  @Min(0.01)
  acquisitionCost: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  residualValue?: number;

  @IsInt()
  @Min(1)
  usefulLifeYears: number;

  @IsOptional()
  @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE'])
  depreciationMethod?: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateFixedAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class GenerateDepreciationDto {
  @IsInt()
  @Min(2000)
  fiscalYear: number;

  @IsDateString()
  periodDate: string;
}

export class DisposeFixedAssetDto {
  @IsDateString()
  disposalDate: string;

  @IsIn(['SALE', 'SCRAPPING', 'OTHER'])
  disposalType: 'SALE' | 'SCRAPPING' | 'OTHER';

  @IsOptional()
  @IsNumber()
  @Min(0)
  disposalPrice?: number;

  // Compte encaissant le prix de cession (trésorerie ou client) —
  // requis uniquement si disposalPrice > 0.
  @IsOptional()
  @IsString()
  counterpartAccountId?: string;

  // Compte de résultat exceptionnel — débité si moins-value, crédité
  // si plus-value (même compte pour les deux sens, comme
  // Invoice.taxAccountId pour la TVA collectée/récupérable).
  @IsString()
  resultAccountId: string;
}
