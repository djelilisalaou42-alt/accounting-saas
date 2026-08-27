import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Choix de conception (Étape 6) : `parentId` n'est volontairement PAS
 * modifiable via cet endpoint. Un compte ne peut donc jamais devenir
 * son propre ancêtre après coup — le risque de cycle hiérarchique est
 * éliminé PAR CONSTRUCTION (le parent est fixé une fois à la création
 * et n'est plus jamais réécrit), plutôt que détecté à l'exécution par
 * un algorithme de parcours de graphe à chaque modification. Un besoin
 * futur de « déplacer » un compte dans l'arborescence (Étape 7+)
 * devra introduire un endpoint dédié avec sa propre détection de cycle
 * explicite — ne pas ajouter `parentId` ici sans cette protection.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label?: string;

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
