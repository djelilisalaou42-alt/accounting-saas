import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Le frontend saisit débit/crédit sur deux colonnes distinctes (plus
 * naturel pour un comptable) ; le backend les convertit en
 * `side`/`amount` pour correspondre au modèle `AccountingEntryLine`
 * déjà en place depuis l'Étape 2/3 (une seule colonne de montant plus
 * un enum de sens — modèle existant réutilisé tel quel, voir README).
 * La règle « débit XOR crédit, jamais les deux » est vérifiée dans le
 * service (accounting-entries.service.ts), pas ici : elle nécessite de
 * comparer les deux champs entre eux.
 */
export class CreateAccountingEntryLineDto {
  @IsString()
  accountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  label?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit: number;
}
