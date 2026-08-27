import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { ReopenAccountingPeriodDto } from './dto/reopen-accounting-period.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/** Code d'erreur PostgreSQL pour une violation de contrainte EXCLUDE (voir Étape 3). */
const PG_EXCLUSION_VIOLATION = '23P01';

@Injectable()
export class AccountingPeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPeriods(companyId: string) {
    return this.prisma.accountingPeriod.findMany({
      where: { companyId },
      include: {
        closedBy: { select: { id: true, firstName: true, lastName: true } },
        reopenedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async getPeriod(companyId: string, periodId: string) {
    return this.getPeriodOrThrow(companyId, periodId);
  }

  async createPeriod(companyId: string, userId: string, dto: CreateAccountingPeriodDto, meta: RequestMetadata) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (!(startDate < endDate)) {
      throw new BadRequestException('La date de début doit être strictement antérieure à la date de fin.');
    }

    // Pré-vérification applicative (message clair) — la garantie réelle
    // reste la contrainte EXCLUDE PostgreSQL posée à l'Étape 3
    // (excl_accounting_periods_no_overlap), revérifiée en cas de
    // concurrence par le catch ci-dessous.
    const overlapping = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        `Cet exercice chevauche l'exercice existant "${overlapping.name}" (${overlapping.startDate.toISOString().slice(0, 10)} → ${overlapping.endDate.toISOString().slice(0, 10)}).`,
      );
    }

    let period;
    try {
      period = await this.prisma.accountingPeriod.create({
        data: { companyId, name: dto.name, startDate, endDate, status: 'OPEN' },
      });
    } catch (err: any) {
      if (err?.code === PG_EXCLUSION_VIOLATION || err?.meta?.code === PG_EXCLUSION_VIOLATION) {
        throw new ConflictException('Cet exercice chevauche un exercice existant pour cette entreprise.');
      }
      throw err;
    }

    await this.audit('CREATE', userId, companyId, 'AccountingPeriod', period.id, null, { name: period.name }, meta);
    return period;
  }

  async closePeriod(companyId: string, periodId: string, userId: string, meta: RequestMetadata) {
    const period = await this.getPeriodOrThrow(companyId, periodId);

    if (period.status !== 'OPEN') {
      throw new ConflictException(`Cet exercice est déjà ${period.status === 'CLOSED' ? 'clôturé' : 'verrouillé'}.`);
    }

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
    });

    await this.audit('CLOSE_PERIOD', userId, companyId, 'AccountingPeriod', periodId, { status: 'OPEN' }, { status: 'CLOSED' }, meta);
    return updated;
  }

  async reopenPeriod(companyId: string, periodId: string, userId: string, dto: ReopenAccountingPeriodDto, meta: RequestMetadata) {
    const period = await this.getPeriodOrThrow(companyId, periodId);

    if (period.status === 'OPEN') {
      throw new ConflictException('Cet exercice est déjà ouvert.');
    }
    if (period.status === 'LOCKED') {
      // Distinction volontaire : CLOSED est réouvrable (avec motif),
      // LOCKED est une clôture définitive (ex: après export fiscal
      // officiel) — non réouvrable via cet endpoint.
      throw new ForbiddenException('Cet exercice est verrouillé définitivement et ne peut plus être rouvert.');
    }

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'OPEN', reopenedAt: new Date(), reopenedById: userId, reopenReason: dto.reason },
    });

    await this.audit(
      'REOPEN_PERIOD',
      userId,
      companyId,
      'AccountingPeriod',
      periodId,
      { status: 'CLOSED' },
      { status: 'OPEN', reason: dto.reason },
      meta,
    );
    return updated;
  }

  private async getPeriodOrThrow(companyId: string, periodId: string) {
    const period = await this.prisma.accountingPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.companyId !== companyId) {
      // Même logique qu'en Étape 5 : un exercice d'une autre entreprise
      // n'existe tout simplement pas "ici", même si l'id est valide.
      throw new NotFoundException('Exercice comptable introuvable pour cette entreprise.');
    }
    return period;
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
