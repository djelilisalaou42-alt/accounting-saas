import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Un seul lien métier autorisé par pièce jointe (conception à FK
// multiples nullables déjà établie dans le modèle Attachment — jamais
// plus d'un renseigné, cohérent avec le schéma qui n'autorise qu'un
// seul objet rattaché par fichier).
export class CreateAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  accountingEntryId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  fixedAssetId?: string;

  @IsOptional()
  @IsString()
  taxDeclarationId?: string;

  @IsOptional()
  @IsString()
  budgetId?: string;
}

export class ListAttachmentsDto {
  @IsOptional()
  @IsIn(['accountingEntry', 'invoice', 'fixedAsset', 'taxDeclaration', 'budget'])
  entityType?: 'accountingEntry' | 'invoice' | 'fixedAsset' | 'taxDeclaration' | 'budget';

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
