import { IsDateString, IsOptional } from 'class-validator';

export class ReverseAccountingEntryDto {
  /**
   * Date de la contrepassation. Ne suppose jamais la date de
   * l'écriture d'origine par défaut si elle appartient à un exercice
   * désormais clôturé (cas fréquent : on contrepasse souvent après
   * clôture) — si omise, le service utilise la date du jour, qui doit
   * elle-même appartenir à un exercice ouvert.
   */
  @IsOptional()
  @IsDateString()
  reversalDate?: string;
}
