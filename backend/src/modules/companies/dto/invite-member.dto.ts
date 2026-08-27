import { IsEmail, IsIn, MaxLength } from 'class-validator';

export const ASSIGNABLE_ROLE_NAMES = [
  'ADMIN',
  'DIRECTOR',
  'ACCOUNTANT',
  'ACCOUNTING_ASSISTANT',
  'AUDITOR',
  'VIEWER',
] as const;
// SUPER_ADMIN volontairement exclu : jamais assignable via une
// invitation d'entreprise (voir schema.prisma / README).

export class InviteMemberDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsIn(ASSIGNABLE_ROLE_NAMES)
  roleName: (typeof ASSIGNABLE_ROLE_NAMES)[number];
}
