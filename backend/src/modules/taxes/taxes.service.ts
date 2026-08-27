import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaxDto, UpdateTaxDto } from './dto/tax.dto';

/**
 * =====================================================================
 * ÉTAPE 13 — Référentiel fiscal GLOBAL (par pays), jamais dupliqué par
 * entreprise — même principe que AccountingFramework/AccountClass
 * (Étape 6). Aucune route de ce module ne dépend de :companyId : la
 * configuration PAR entreprise (comptes réels portant chaque taxe) vit
 * dans CompanyTaxSettings (module tax-declarations), pas ici.
 *
 * Décision d'architecture (documentée, cf. README) : PermissionsGuard
 * exige structurellement un :companyId dans l'URL (voir son code) — il
 * ne peut donc pas gater une route globale par pays. La gestion du
 * référentiel global (création/modification/activation d'une taxe) est
 * donc réservée à `user.isSuperAdmin`, exactement comme AccountingFramework/
 * AccountClass n'exposent aujourd'hui aucune route d'écriture du tout
 * (seed uniquement) — ici une route existe mais réutilise le mécanisme
 * de séparation plateforme/entreprise déjà présent (`isSuperAdmin`),
 * sans créer de nouveau système d'autorisation.
 * =====================================================================
 */
@Injectable()
export class TaxesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(country?: string, includeInactive = false) {
    return this.prisma.tax.findMany({
      where: { country: country || undefined, isActive: includeInactive ? undefined : true },
      orderBy: [{ country: 'asc' }, { code: 'asc' }],
    });
  }

  async get(id: string) {
    const tax = await this.prisma.tax.findUnique({ where: { id } });
    if (!tax) throw new NotFoundException('Taxe introuvable.');
    return tax;
  }

  private assertSuperAdmin(user: { isSuperAdmin?: boolean }): void {
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Seul un administrateur plateforme peut gérer le référentiel fiscal global.');
    }
  }

  async create(user: { isSuperAdmin?: boolean }, dto: CreateTaxDto) {
    this.assertSuperAdmin(user);
    const existing = await this.prisma.tax.findFirst({ where: { country: dto.country, code: dto.code, startDate: new Date(dto.startDate) } });
    if (existing) throw new ConflictException(`La taxe "${dto.code}" existe déjà pour ${dto.country} à cette date d'entrée en vigueur.`);

    return this.prisma.tax.create({
      data: {
        country: dto.country,
        code: dto.code,
        label: dto.label,
        type: (dto.type ?? 'VAT') as any,
        rate: dto.rate,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  async update(user: { isSuperAdmin?: boolean }, id: string, dto: UpdateTaxDto) {
    this.assertSuperAdmin(user);
    await this.get(id);
    return this.prisma.tax.update({
      where: { id },
      data: { label: dto.label, rate: dto.rate, endDate: dto.endDate ? new Date(dto.endDate) : undefined },
    });
  }

  async disable(user: { isSuperAdmin?: boolean }, id: string) {
    this.assertSuperAdmin(user);
    const tax = await this.get(id);
    if (!tax.isActive) throw new ConflictException('Cette taxe est déjà désactivée.');
    return this.prisma.tax.update({ where: { id }, data: { isActive: false } });
  }

  async enable(user: { isSuperAdmin?: boolean }, id: string) {
    this.assertSuperAdmin(user);
    const tax = await this.get(id);
    if (tax.isActive) throw new ConflictException('Cette taxe est déjà active.');
    return this.prisma.tax.update({ where: { id }, data: { isActive: true } });
  }
}
