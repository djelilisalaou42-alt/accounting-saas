import { IsString, MinLength } from 'class-validator';

/**
 * Le contenu CSV est transmis en texte brut dans le corps JSON (pas de
 * upload multipart) : le frontend lit le fichier choisi via l'API
 * `File`/`FileReader` du navigateur et envoie son contenu textuel.
 * Évite d'ajouter une dépendance d'upload de fichiers (multer) pour un
 * besoin aussi simple à ce stade du projet.
 */
export class ImportAccountsDto {
  @IsString()
  @MinLength(1)
  csvContent: string;
}
