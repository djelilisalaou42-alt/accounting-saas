import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

/**
 * =====================================================================
 * ÉTAPE 17 — Journal d'audit consultable.
 *
 * Le modèle `AuditLog` et son écriture existaient DÉJÀ dans son
 * intégralité (schéma initial, Étape 2) — companyId, userId, action,
 * entityType/entityId, oldValue/newValue (JSON), ipAddress, userAgent,
 * createdAt, avec les 4 index déjà en place
 * (companyId / userId / [entityType,entityId] / createdAt). 18
 * services écrivent déjà dans ce journal (accounting-entries, cash,
 * invoices, fixed-assets, tax-declarations, budgets, attachments,
 * auth, etc.). Ce module n'ajoute AUCUNE écriture ni colonne — il
 * construit UNIQUEMENT la couche de consultation manquante autour du
 * système déjà en place, comme demandé : jamais un second système
 * d'audit parallèle.
 *
 * Immutabilité : ce service n'expose que des méthodes de LECTURE
 * (list/get/exportCsv) — aucune méthode update()/delete() n'existe et
 * aucun endpoint n'est câblé pour en ajouter (voir controller). Une
 * entrée du journal, une fois écrite par le service métier concerné,
 * ne peut plus être modifiée ni supprimée par aucun rôle applicatif,
 * y compris via ce module.
 *
 * Isolation multi-tenant : toute méthode ci-dessous filtre
 * STRICTEMENT sur companyId = paramètre de route (jamais celui d'un
 * filtre utilisateur). Les événements globaux/plateforme
 * (LOGIN/LOGOUT/REGISTER/PASSWORD_xxx/REFRESH/REVOKE, `companyId IS
 * NULL` par conception — un utilisateur n'est pas encore rattaché à
 * une entreprise au moment de se connecter) ne sont structurellement
 * JAMAIS renvoyés par ce filtre : `WHERE company_id = $1` exclut
 * toute ligne à `company_id IS NULL`, qu'aucun utilisateur d'entreprise
 * ne peut donc consulter, même avec la permission AUDIT.READ — seule
 * une administration plateforme distincte (hors périmètre de ce
 * module, non demandée) y aurait accès. Documenté, pas construit :
 * aucun endpoint de consultation globale n'est ajouté ici.
 * =====================================================================
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(companyId: string, filters: ListAuditLogsDto) {
    const where: any = { companyId };
    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
    }
    if (filters.search) {
      where.OR = [{ entityId: { contains: filters.search, mode: 'insensitive' } }, { entityType: { contains: filters.search, mode: 'insensitive' } }];
    }
    return where;
  }

  async list(companyId: string, filters: ListAuditLogsDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const where = this.buildWhere(companyId, filters);
    const orderBy = { [filters.sortBy ?? 'createdAt']: filters.sortOrder ?? 'desc' };

    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { logs, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(companyId: string, id: string) {
    const log = await this.prisma.auditLog.findUnique({ where: { id }, include: { user: { select: { firstName: true, lastName: true, email: true } } } });
    // companyId revérifié explicitement (défense en profondeur, même
    // principe que les autres modules) : le guard de permissions a
    // déjà vérifié l'appartenance à l'entreprise, mais un `id` d'une
    // autre entreprise ne doit jamais être exploitable par simple
    // devinette d'UUID.
    if (!log || log.companyId !== companyId) throw new NotFoundException('Événement introuvable pour cette entreprise.');
    return log;
  }

  async exportCsv(companyId: string, filters: ListAuditLogsDto): Promise<string> {
    const where = this.buildWhere(companyId, filters);
    const orderBy = { [filters.sortBy ?? 'createdAt']: filters.sortOrder ?? 'desc' };
    // Export : pas de pagination — respecte les filtres actifs mais
    // couvre l'ensemble des résultats correspondants, jamais les logs
    // d'une autre entreprise (même `where` que list()).
    const logs = await this.prisma.auditLog.findMany({
      where,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy,
    });

    const header = ['Date', 'Utilisateur', 'Action', 'Type objet', 'ID objet', 'IP', 'User-Agent'];
    const rows = logs.map((l: any) => [
      l.createdAt.toISOString(),
      l.user ? `${l.user.firstName} ${l.user.lastName} (${l.user.email})` : '—',
      l.action,
      l.entityType,
      l.entityId ?? '',
      l.ipAddress ?? '',
      l.userAgent ?? '',
    ]);
    return this.toCsv([header, ...rows]);
  }

  // Même utilitaire que ReportsService.toCsv (Étape 8/15) — dupliqué
  // à l'identique plutôt que de créer une dépendance entre modules
  // pour une fonction pure de 8 lignes ; mêmes règles d'échappement.
  private toCsv(rows: string[][]): string {
    const escapeField = (field: string): string => {
      if (/[;"\n\r]/.test(field)) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    const body = rows.map((row) => row.map(escapeField).join(';')).join('\r\n');
    return '\uFEFF' + body;
  }
}
