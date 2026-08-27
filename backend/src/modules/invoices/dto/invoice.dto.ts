import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class InvoiceItemDto {
  @IsString()
  description: string;

  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  // Compte de produit/charge — obligatoire dès qu'un taux de TVA ou une
  // comptabilisation est attendue ; validé côté service (jamais déduit
  // ou codé en dur).
  @IsString()
  accountId: string;
}

export class CreateInvoiceDto {
  @IsIn(['SALE', 'PURCHASE'])
  invoiceType: 'SALE' | 'PURCHASE';

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsDateString()
  issueDate: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Compte de TVA (collectée ou récupérable) — requis uniquement si au
  // moins une ligne porte un taux de TVA > 0.
  @IsOptional()
  @IsString()
  taxAccountId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Une facture doit comporter au moins une ligne.' })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  taxAccountId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}
