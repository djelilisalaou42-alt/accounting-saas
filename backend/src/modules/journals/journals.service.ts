import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJournalDto, UpdateJournalDto } from './dto/journal.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Journaux de démonstration/configuration (ACH, VEN, BQ, CA, OD) — ce
 * ne sont PAS une nomenclature légale obligatoire, seulement des
 * exemples de types de journaux courants proposés à la création d'une
 * entreprise. Utilisés uniquement par le seed de démonstration, jamais
 * codés en dur dans le service métier lui-même (le service accepte
 * n'importe quel code/libellé fourni par l'utilisateur).
 */
@Injectable()
export class JournalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string) {
    return this.prisma.journal.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  async get(companyId: string, journalId: string) {
    return this.getOrThrow(companyId, journalId);
  }

  async create(companyId: string, userId: string, dto: CreateJournalDto, meta: RequestMetadata) {
    const existing = await this.prisma.journal.findUnique({ where: { companyId_code: { companyId, code: dto.code } } });
    if (existing) throw new ConflictException(`Le code journal "${dto.code}" existe déjà pour cette entreprise.`);

    const journal = await this.prisma.journal.create({
      data: { companyId, code: dto.code, label: dto.label, type: dto.type as any },
    });

    await this.audit('CREATE', userId, companyId, 'Journal', journal.id, null, { code: journal.code }, meta);
    return journal;
  }

  async update(companyId: string, journalId: string, userId: string, dto: UpdateJournalDto, meta: RequestMetadata) {
    const before = await this.getOrThrow(companyId, journalId);
    const updated = await this.prisma.journal.update({ where: { id: journalId }, data: { label: dto.label } });
    await this.audit('UPDATE', userId, companyId, 'Journal', journalId, { label: before.label }, { label: updated.label }, meta);
    return updated;
  }

  async disable(companyId: string, journalId: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, journalId);
    const updated = await this.prisma.journal.update({ where: { id: journalId }, data: { isActive: false } });
    await this.audit('UPDATE', userId, companyId, 'Journal', journalId, null, { isActive: false }, meta);
    return updated;
  }

  async enable(companyId: string, journalId: string, userId: string, meta: RequestMetadata) {
    await this.getOrThrow(companyId, journalId);
    const updated = await this.prisma.journal.update({ where: { id: journalId }, data: { isActive: true } });
    await this.audit('UPDATE', userId, companyId, 'Journal', journalId, null, { isActive: true }, meta);
    return updated;
  }

  private async getOrThrow(companyId: string, journalId: string) {
    const journal = await this.prisma.journal.findUnique({ where: { id: journalId } });
    if (!journal || journal.companyId !== companyId) {
      throw new NotFoundException('Journal introuvable pour cette entreprise.');
    }
    return journal;
  }

  private async audit(
    action: string,
    userId: string,
    companyId: string,
    entityType: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
    meta: RequestMetadata,
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
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });
    } catch {
      // L'audit ne doit jamais faire échouer l'action métier elle-même.
    }
  }
}
