import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const AUDIT_ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'VALIDATE', 'REVERSE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'EXPORT',
  'PERMISSION_CHANGE', 'CLOSE_PERIOD', 'REOPEN_PERIOD', 'SETTINGS_CHANGE', 'LETTERING', 'UNLETTERING',
  'REVOKE', 'REGISTER', 'LOGOUT_ALL', 'REFRESH', 'PASSWORD_CHANGE', 'PASSWORD_RESET_REQUEST',
  'PASSWORD_RESET', 'COMPANY_CREATE', 'COMPANY_UPDATE', 'MEMBER_INVITE', 'MEMBER_ROLE_CHANGE',
  'MEMBER_DISABLE', 'MEMBER_ENABLE', 'MEMBER_REMOVE', 'COMPANY_SWITCH', 'PERMISSION_DENIED',
  'ACCOUNT_DISABLE', 'ACCOUNT_ENABLE', 'ACCOUNT_IMPORT',
] as const;

export class ListAuditLogsDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  // Recherche libre — appliquée à entityId et au libellé de l'action
  // uniquement (jamais à oldValue/newValue : ce sont des blobs JSON,
  // une recherche texte dessus serait coûteuse et peu fiable sur un
  // volume de journal important).
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['createdAt', 'action', 'entityType'])
  sortBy?: 'createdAt' | 'action' | 'entityType';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
