import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * Le montant total débit/crédit n'est JAMAIS envoyé par le client — le
 * service recalcule systématiquement la somme depuis les lignes en
 * base (voir lettering.service.ts). Seule la sélection des lignes à
 * associer est fournie ici.
 */
export class CreateLetteringDto {
  @IsString()
  accountId: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'Un lettrage doit comporter au moins deux lignes.' })
  @ArrayMaxSize(200, { message: 'Un lettrage ne peut pas dépasser 200 lignes.' })
  @ArrayUnique({ message: 'La sélection contient une ligne en double.' })
  @IsString({ each: true })
  lineIds: string[];
}
