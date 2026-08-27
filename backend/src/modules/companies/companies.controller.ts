import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ips?.length ? req.ips[0] : req.ip,
  };
}

@Controller()
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // ---------------------------------------------------------------------
  // GET /companies — entreprises accessibles par l'utilisateur connecté
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @Get('companies')
  async listMyCompanies(@CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.listMyCompanies(user.id);
  }

  // ---------------------------------------------------------------------
  // POST /companies — création, créateur devient ADMIN automatiquement
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @Post('companies')
  async createCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanyDto, @Req() req: Request) {
    return this.companiesService.createCompany(user.id, dto, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // GET /companies/:companyId
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('COMPANY.READ')
  @Get('companies/:companyId')
  async getCompany(@Param('companyId') companyId: string) {
    return this.companiesService.getCompany(companyId);
  }

  // ---------------------------------------------------------------------
  // PATCH /companies/:companyId
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('COMPANY.UPDATE')
  @Patch('companies/:companyId')
  async updateCompany(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCompanyDto,
    @Req() req: Request,
  ) {
    return this.companiesService.updateCompany(companyId, user.id, dto, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // POST /companies/:companyId/switch — confirme l'accès, ne pose aucun
  // état serveur (voir companies.service.ts). Aucune permission
  // particulière au-delà de l'appartenance elle-même : pas de
  // @RequirePermissions ici.
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @HttpCode(HttpStatus.OK)
  @Post('companies/:companyId/switch')
  async switchCompany(@Param('companyId') companyId: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.companiesService.switchCompany(user.id, companyId, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // GET /companies/:companyId/members
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('USER.READ')
  @Get('companies/:companyId/members')
  async listMembers(@Param('companyId') companyId: string) {
    return this.companiesService.listMembers(companyId);
  }

  // ---------------------------------------------------------------------
  // POST /companies/:companyId/members/invite
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('USER.CREATE')
  @Post('companies/:companyId/members/invite')
  async inviteMember(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
    @Req() req: Request,
  ) {
    return this.companiesService.inviteMember(companyId, user.id, dto, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // GET /companies/invitations/:token — prévisualisation PUBLIQUE (pas
  // d'authentification requise, l'utilisateur n'a pas forcément encore
  // de session au moment où il ouvre le lien reçu par email).
  // ---------------------------------------------------------------------
  @Get('companies/invitations/:token')
  async previewInvitation(@Param('token') token: string) {
    return this.companiesService.previewInvitation(token);
  }

  // ---------------------------------------------------------------------
  // POST /companies/invitations/:token/accept
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('companies/invitations/:token/accept')
  async acceptInvitation(@Param('token') token: string, @CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.acceptInvitation(token, user.id, user.email);
  }

  // ---------------------------------------------------------------------
  // PATCH /companies/:companyId/members/:userCompanyId/role
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('USER.UPDATE')
  @Patch('companies/:companyId/members/:userCompanyId/role')
  async updateMemberRole(
    @Param('companyId') companyId: string,
    @Param('userCompanyId') userCompanyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    return this.companiesService.updateMemberRole(companyId, userCompanyId, user.id, dto, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // POST /companies/:companyId/members/:userCompanyId/disable
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('USER.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post('companies/:companyId/members/:userCompanyId/disable')
  async disableMember(
    @Param('companyId') companyId: string,
    @Param('userCompanyId') userCompanyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.companiesService.disableMember(companyId, userCompanyId, user.id, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // POST /companies/:companyId/members/:userCompanyId/enable
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('USER.DISABLE')
  @HttpCode(HttpStatus.OK)
  @Post('companies/:companyId/members/:userCompanyId/enable')
  async enableMember(
    @Param('companyId') companyId: string,
    @Param('userCompanyId') userCompanyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.companiesService.enableMember(companyId, userCompanyId, user.id, extractMetadata(req));
  }

  // ---------------------------------------------------------------------
  // DELETE /companies/:companyId/members/:userCompanyId — retrait doux
  // ---------------------------------------------------------------------
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('USER.DISABLE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('companies/:companyId/members/:userCompanyId')
  async removeMember(
    @Param('companyId') companyId: string,
    @Param('userCompanyId') userCompanyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.companiesService.removeMember(companyId, userCompanyId, user.id, extractMetadata(req));
  }
}
