import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Règle de robustesse du mot de passe : au moins 10 caractères, une
 * majuscule, une minuscule, un chiffre et un caractère spécial. Le
 * message d'erreur reste volontairement descriptif ici (formulaire
 * d'inscription) — ce n'est PAS le cas pour les erreurs de connexion
 * (voir login.dto.ts / auth.service.ts), qui doivent rester génériques.
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export class RegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  @MaxLength(128)
  @Matches(PASSWORD_REGEX, {
    message:
      'Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial.',
  })
  password: string;
}
