import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../auth/mail/mail.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/token.util';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // =====================================================================
  // ENTREPRISES
  // =====================================================================

  /** Liste UNIQUEMENT les entreprises où l'utilisateur a une appartenance active. */
  async listMyCompanies(userId: string) {
    const memberships = await this.prisma.userCompany.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { company: true, role: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m: any) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      companyStatus: m.company.status,
      roleName: m.role.name,
      isDefault: m.isDefault,
    }));
  }

  async createCompany(userId: string, dto: CreateCompanyDto, meta: RequestMetadata) {
    const adminRole = await this.prisma.role.findFirst({ where: { name: 'ADMIN', companyId: null } });
    if (!adminRole) {
      // Ne devrait jamais se produire si le seed a été exécuté.
      throw new BadRequestException("Rôle ADMIN introuvable — le seed des rôles système a-t-il été exécuté ?");
    }

    // Référentiel comptable par défaut : SYSCOHADA Révisé (Étape 6).
    // Une entreprise créée sans indication explicite reçoit ce
    // référentiel — jamais laissé null, pour que le plan comptable
    // puisse être construit immédiatement après création.
    const defaultFramework = await this.prisma.accountingFramework.findUnique({ where: { code: 'SYSCOHADA_REVISED' } });
    if (!defaultFramework) {
      throw new BadRequestException('Référentiel comptable par défaut introuvable — la migration Étape 6 a-t-elle été appliquée ?');
    }

    const existingCount = await this.prisma.userCompany.count({ where: { userId, status: 'ACTIVE' } });

    const { company, userCompany } = await this.prisma.$transaction(async (tx: any) => {
      const company = await tx.company.create({
        data: {
          name: dto.name,
          legalName: dto.legalName,
          registrationNumber: dto.registrationNumber,
          taxIdNumber: dto.taxIdNumber,
          country: dto.country,
          currency: dto.currency ?? 'XOF',
          address: dto.address,
          phone: dto.phone,
          email: dto.email,
          accountingFrameworkId: defaultFramework.id,
        },
      });

      // Le créateur devient automatiquement ADMIN de l'entreprise créée.
      const userCompany = await tx.userCompany.create({
        data: {
          userId,
          companyId: company.id,
          roleId: adminRole.id,
          status: 'ACTIVE',
          isDefault: existingCount === 0, // première entreprise -> par défaut
        },
      });

      return { company, userCompany };
    });

    await this.audit('COMPANY_CREATE', userId, company.id, 'Company', company.id, null, { name: company.name }, meta);

    return { company, userCompanyId: userCompany.id, roleName: 'ADMIN' };
  }

  async getCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Entreprise introuvable.');
    return company;
  }

  async updateCompany(companyId: string, userId: string, dto: UpdateCompanyDto, meta: RequestMetadata) {
    const before = await this.getCompany(companyId);
    const updated = await this.prisma.company.update({ where: { id: companyId }, data: dto });

    await this.audit(
      'COMPANY_UPDATE',
      userId,
      companyId,
      'Company',
      companyId,
      { name: before.name, email: before.email },
      { name: updated.name, email: updated.email },
      meta,
    );

    return updated;
  }

  /**
   * Ne pose AUCUN état côté serveur — confirme uniquement que
   * l'utilisateur a bien accès à l'entreprise ciblée (déjà vérifié par
   * PermissionsGuard avant d'arriver ici) et renvoie le contexte
   * (rôle + permissions) que le frontend doit utiliser pour adapter son
   * interface. Chaque requête métier ultérieure revérifiera
   * intégralement l'accès via PermissionsGuard — voir README.
   */
  async switchCompany(userId: string, companyId: string, meta: RequestMetadata) {
    await this.audit('COMPANY_SWITCH', userId, companyId, 'Company', companyId, null, null, meta);
    return { companyId, switchedAt: new Date().toISOString() };
  }

  // =====================================================================
  // MEMBRES
  // =====================================================================

  async listMembers(companyId: string) {
    const members = await this.prisma.userCompany.findMany({
      where: { companyId, status: { not: 'REMOVED' } },
      include: { user: true, role: true },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m: any) => ({
      userCompanyId: m.id,
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      roleName: m.role.name,
      status: m.status,
      isDefault: m.isDefault,
    }));
  }

  async inviteMember(companyId: string, invitedById: string, dto: InviteMemberDto, meta: RequestMetadata) {
    const role = await this.prisma.role.findFirst({ where: { name: dto.roleName, companyId: null } });
    if (!role) throw new BadRequestException('Rôle inconnu.');

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      const existingMembership = await this.prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: existingUser.id, companyId } },
      });
      if (existingMembership && existingMembership.status === 'ACTIVE') {
        throw new ConflictException('Cet utilisateur est déjà membre actif de cette entreprise.');
      }
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const invitation = await this.prisma.companyInvitation.create({
      data: {
        companyId,
        email: dto.email,
        roleId: role.id,
        tokenHash,
        expiresAt,
        invitedById,
      },
    });

    await this.audit('MEMBER_INVITE', invitedById, companyId, 'CompanyInvitation', invitation.id, null, { email: dto.email, role: dto.roleName }, meta);

    const invitationUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/companies/invitations/${rawToken}`;
    await this.mailService.sendCompanyInvitationEmail(dto.email, rawToken, invitationUrl);

    return { invitationId: invitation.id, email: dto.email, roleName: dto.roleName, expiresAt };
  }

  /**
   * Prévisualisation PUBLIQUE (aucune authentification requise) d'une
   * invitation à partir du token brut reçu dans l'URL. Ne renvoie QUE
   * ce qui est nécessaire à l'affichage (nom d'entreprise, email
   * invité, nom du rôle, statut normalisé) — jamais l'id interne du
   * rôle, l'id de l'entreprise avant acceptation réelle, ni aucune
   * autre donnée. Le rôle et l'entreprise proposés viennent
   * EXCLUSIVEMENT de la ligne CompanyInvitation retrouvée via le hash
   * du token — jamais d'un paramètre fourni par l'appelant.
   */
  async previewInvitation(rawToken: string) {
    const tokenHash = hashOpaqueToken(rawToken);
    const invitation = await this.prisma.companyInvitation.findUnique({
      where: { tokenHash },
      include: { company: true, role: true },
    });

    if (!invitation) {
      // Volontairement le même statut générique que pour un token
      // syntaxiquement valide mais inconnu — ne jamais laisser deviner
      // si un token a existé un jour.
      throw new NotFoundException('Invitation introuvable.');
    }

    const isExpired = invitation.expiresAt < new Date();
    const normalizedStatus =
      invitation.status === 'ACCEPTED'
        ? 'ACCEPTED'
        : invitation.status === 'REVOKED'
          ? 'REVOKED'
          : isExpired
            ? 'EXPIRED'
            : 'PENDING';

    return {
      companyName: invitation.company.name,
      email: invitation.email,
      roleName: invitation.role.name,
      status: normalizedStatus,
    };
  }

  async acceptInvitation(rawToken: string, acceptingUserId: string, acceptingUserEmail: string) {
    const tokenHash = hashOpaqueToken(rawToken);
    const invitation = await this.prisma.companyInvitation.findUnique({ where: { tokenHash } });

    if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
      throw new UnauthorizedException("Invitation invalide, expirée ou déjà utilisée.");
    }

    if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
      // Ne pas préciser lequel des deux ne correspond pas (même logique
      // anti-énumération que pour le login).
      throw new ForbiddenException("Cette invitation ne correspond pas à votre compte.");
    }

    const userCompany = await this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.userCompany.findUnique({
        where: { userId_companyId: { userId: acceptingUserId, companyId: invitation.companyId } },
      });

      const uc = existing
        ? await tx.userCompany.update({
            where: { id: existing.id },
            data: { roleId: invitation.roleId, status: 'ACTIVE', disabledAt: null, disabledById: null, invitationId: invitation.id },
          })
        : await tx.userCompany.create({
            data: {
              userId: acceptingUserId,
              companyId: invitation.companyId,
              roleId: invitation.roleId,
              status: 'ACTIVE',
              invitationId: invitation.id,
            },
          });

      await tx.companyInvitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });

      return uc;
    });

    return { companyId: invitation.companyId, userCompanyId: userCompany.id };
  }

  async updateMemberRole(companyId: string, userCompanyId: string, actingUserId: string, dto: UpdateMemberRoleDto, meta: RequestMetadata) {
    const membership = await this.getMembershipOrThrow(companyId, userCompanyId);
    const role = await this.prisma.role.findFirst({ where: { name: dto.roleName, companyId: null } });
    if (!role) throw new BadRequestException('Rôle inconnu.');

    const before = membership.roleId;
    const updated = await this.prisma.userCompany.update({ where: { id: userCompanyId }, data: { roleId: role.id } });

    await this.audit('MEMBER_ROLE_CHANGE', actingUserId, companyId, 'UserCompany', userCompanyId, { roleId: before }, { roleId: role.id, roleName: dto.roleName }, meta);

    return updated;
  }

  async disableMember(companyId: string, userCompanyId: string, actingUserId: string, meta: RequestMetadata) {
    await this.getMembershipOrThrow(companyId, userCompanyId);

    const updated = await this.prisma.userCompany.update({
      where: { id: userCompanyId },
      data: { status: 'DISABLED', disabledAt: new Date(), disabledById: actingUserId },
    });

    await this.audit('MEMBER_DISABLE', actingUserId, companyId, 'UserCompany', userCompanyId, null, null, meta);
    return updated;
  }

  async enableMember(companyId: string, userCompanyId: string, actingUserId: string, meta: RequestMetadata) {
    await this.getMembershipOrThrow(companyId, userCompanyId);

    const updated = await this.prisma.userCompany.update({
      where: { id: userCompanyId },
      data: { status: 'ACTIVE', disabledAt: null, disabledById: null },
    });

    await this.audit('MEMBER_ENABLE', actingUserId, companyId, 'UserCompany', userCompanyId, null, null, meta);
    return updated;
  }

  /** Retrait "doux" : jamais de suppression physique d'un membre. */
  async removeMember(companyId: string, userCompanyId: string, actingUserId: string, meta: RequestMetadata) {
    await this.getMembershipOrThrow(companyId, userCompanyId);

    const updated = await this.prisma.userCompany.update({
      where: { id: userCompanyId },
      data: { status: 'REMOVED', disabledAt: new Date(), disabledById: actingUserId },
    });

    await this.audit('MEMBER_REMOVE', actingUserId, companyId, 'UserCompany', userCompanyId, null, null, meta);
    return updated;
  }

  private async getMembershipOrThrow(companyId: string, userCompanyId: string) {
    const membership = await this.prisma.userCompany.findUnique({ where: { id: userCompanyId } });
    if (!membership || membership.companyId !== companyId) {
      // Vérification explicite : un ADMIN de l'entreprise A ne doit
      // jamais pouvoir agir sur une ligne UserCompany appartenant à
      // l'entreprise B, même en devinant un userCompanyId valide.
      throw new NotFoundException('Membre introuvable pour cette entreprise.');
    }
    return membership;
  }

  // =====================================================================
  // AUDIT
  // =====================================================================

  private async audit(
    action: string,
    userId: string | null,
    companyId: string | null,
    entityType: string,
    entityId: string | null,
    oldValue: unknown,
    newValue: unknown,
    meta?: RequestMetadata,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          companyId,
          action: action as any,
          entityType,
          entityId,
          oldValue: oldValue as any,
          newValue: newValue as any,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch {
      // L'audit ne doit jamais faire échouer l'action métier elle-même.
    }
  }
}
