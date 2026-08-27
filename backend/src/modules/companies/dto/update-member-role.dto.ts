import { IsIn } from 'class-validator';
import { ASSIGNABLE_ROLE_NAMES } from './invite-member.dto';

export class UpdateMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLE_NAMES)
  roleName: (typeof ASSIGNABLE_ROLE_NAMES)[number];
}
