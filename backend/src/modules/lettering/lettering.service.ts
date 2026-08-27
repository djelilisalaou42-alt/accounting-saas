import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLetteringDto } from './dto/create-lettering.dto';
import { ListLetteringDto } from './dto/list-lettering.dto';
import { UnletteredLinesQueryDto } from './dto/unlettered-lines-query.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * RÈGLES CENTRALES (Étape 9) — documentées ici, elles conditionnent
 * tout ce service :
 *
 * 1. LIGNES LETTRABLES : une ligne n'est lettrable que si son écriture
 *    parente est VALIDATED **ou** REVERSED — jamais DRAFT. Ce choix est
 *    délibérément symétrique avec la règle des rapports (Étape 8,
 *    `status <> 'DRAFT'`) : une écriture REVERSED reste un mouvement
 *    historiquement réel (voir §22 du cahier des charges), et sa
 *    contrepassation ne supprime jamais l'historique — le lettrage ne
 *    modifie jamais le statut d'une écriture pour fonctionner.
 *
 * 2. AUCUN LETTRAGE PARTIEL EN BASE : le modèle `Lettering` existant
 *    (trigger `fn_check_lettering_balance`, Étape 3) n'admet que des
 *    lettrages où la somme débit-crédit des lignes rattachées est
 *    exactement nulle. Un « lettrage partiel » (ex: facture 1 000 000
 *    + règlement 600 000) n'est donc PAS représenté par un objet
 *    Lettering déséquilibré : le reliquat reste simplement une ligne
 *    non lettrée (`letteringId IS NULL`), disponible pour un futur
 *    lettrage dès qu'une contrepartie complète le solde à zéro.
 *
 * 3. WORKFLOW EN DEUX TEMPS : `create()` crée le lettrage et rattache
 *    les lignes (`isBalanced=false`), `close()` confirme et bascule
 *    `isBalanced=true` — c'est cette transition que le trigger SQL
 *    vérifie réellement (défense en profondeur : le service recalcule
 *    déjà la somme depuis la base avant d'appeler close()). Ce
 *    découpage correspond à l'UX demandée (§33 : aperçu puis
 *    confirmation explicite avant clôture).
 *
 * 4. TRIGGER MODIFIÉ (migration 20260823100000) : la protection
 *    d'immuabilité des lignes validées (Étape 3) autorise désormais
 *    UNIQUEMENT un UPDATE qui ne change que `lettering_id` — jamais le
 *    montant, le sens, le compte ou la date. Aucune autre écriture
 *    VALIDATED n'est jamais modifiée par ce service.
 * =====================================================================
 */
@Injectable()
export class LetteringService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // LECTURE
  // =====================================================================

  async listUnletteredLines(companyId: string, accountId: string, query: UnletteredLinesQueryDto) {
    const account = await this.getAccountOrThrow(companyId, accountId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const searchFilter = query.search ? `%${query.search}%` : null;

    const countRows: Array<{ count: string }> = await this.prisma.$queryRaw`
      SELECT COUNT(*)::text AS count
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}
        AND l.account_id = ${accountId}
        AND l.lettering_id IS NULL
        AND e.status <> 'DRAFT'
        AND (${searchFilter}::text IS NULL OR e.entry_number ILIKE ${searchFilter} OR e.label ILIKE ${searchFilter} OR l.label ILIKE ${searchFilter})
    `;
    const total = Number(countRows[0].count);

    const rows: Array<{
      id: string;
      entry_date: Date;
      entry_number: string;
      entry_label: string;
      entry_status: string;
      line_label: string | null;
      side: 'DEBIT' | 'CREDIT';
      amount: string;
      journal_code: string;
    }> = await this.prisma.$queryRaw`
      SELECT l.id, e.entry_date, e.entry_number, e.label AS entry_label, e.status AS entry_status,
             l.label AS line_label, l.side, l.amount::text AS amount, j.code AS journal_code
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      JOIN journals j ON j.id = e.journal_id
      WHERE l.company_id = ${companyId}
        AND l.account_id = ${accountId}
        AND l.lettering_id IS NULL
        AND e.status <> 'DRAFT'
        AND (${searchFilter}::text IS NULL OR e.entry_number ILIKE ${searchFilter} OR e.label ILIKE ${searchFilter} OR l.label ILIKE ${searchFilter})
      ORDER BY e.entry_date, e.entry_number, l.line_number
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    return {
      account: { id: account.id, code: account.code, label: account.label, isPostable: account.isPostable },
      lines: rows.map((r) => ({
        id: r.id,
        entryDate: r.entry_date,
        entryNumber: r.entry_number,
        entryLabel: r.entry_label,
        entryStatus: r.entry_status,
        lineLabel: r.line_label,
        journalCode: r.journal_code,
        debit: r.side === 'DEBIT' ? Number(r.amount) : 0,
        credit: r.side === 'CREDIT' ? Number(r.amount) : 0,
      })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async list(companyId: string, filters: ListLetteringDto) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const codeFilter = filters.code ? `%${filters.code}%` : null;
    const searchFilter = filters.search ? `%${filters.search}%` : null;
    const startDate = filters.startDate ? new Date(filters.startDate) : null;
    const endDate = filters.endDate ? new Date(filters.endDate) : null;

    // status dérivé applicativement (canceledAt -> CANCELED, isBalanced
    // -> CLOSED, sinon OPEN) — pas de colonne "status" dupliquée dans le
    // modèle existant, réutilisation stricte des champs déjà présents.
    let statusCondition = '';
    if (filters.status === 'CANCELED') statusCondition = 'AND lt.canceled_at IS NOT NULL';
    else if (filters.status === 'CLOSED') statusCondition = 'AND lt.canceled_at IS NULL AND lt.is_balanced = true';
    else if (filters.status === 'OPEN') statusCondition = 'AND lt.canceled_at IS NULL AND lt.is_balanced = false';

    const rows: Array<{
      id: string;
      code: string;
      account_id: string;
      account_code: string;
      account_label: string;
      is_balanced: boolean;
      canceled_at: Date | null;
      created_at: Date;
      created_by_first: string;
      created_by_last: string;
      total_debit: string;
      total_credit: string;
      line_count: string;
    }> = await this.prisma.$queryRawUnsafe(
      `
      SELECT lt.id, lt.code, lt.account_id, a.code AS account_code, a.label AS account_label,
             lt.is_balanced, lt.canceled_at, lt.created_at,
             u.first_name AS created_by_first, u.last_name AS created_by_last,
             COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS total_debit,
             COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS total_credit,
             COUNT(l.id)::text AS line_count
      FROM letterings lt
      JOIN accounts a ON a.id = lt.account_id
      JOIN users u ON u.id = lt.created_by_id
      LEFT JOIN accounting_entry_lines l ON l.lettering_id = lt.id
      WHERE lt.company_id = $1
        ${filters.accountId ? 'AND lt.account_id = $2' : ''}
        ${statusCondition}
      GROUP BY lt.id, a.code, a.label, u.first_name, u.last_name
      ORDER BY lt.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
      companyId,
      ...(filters.accountId ? [filters.accountId] : []),
    );

    // Filtres additionnels appliqués en mémoire sur la page déjà agrégée
    // (code/recherche/dates) — le volume par page reste borné par
    // pageSize, donc pas de risque de performance ici contrairement à
    // une agrégation sur l'ensemble des écritures.
    let filtered = rows;
    if (codeFilter) filtered = filtered.filter((r) => r.code.toLowerCase().includes(filters.code!.toLowerCase()));
    if (searchFilter) {
      const q = filters.search!.toLowerCase();
      filtered = filtered.filter(
        (r) => r.code.toLowerCase().includes(q) || r.account_code.toLowerCase().includes(q) || r.account_label.toLowerCase().includes(q),
      );
    }
    if (startDate) filtered = filtered.filter((r) => new Date(r.created_at) >= startDate);
    if (endDate) filtered = filtered.filter((r) => new Date(r.created_at) <= endDate);

    const totalCountRows: Array<{ count: string }> = await this.prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text AS count FROM letterings lt WHERE lt.company_id = $1 ${filters.accountId ? 'AND lt.account_id = $2' : ''}`,
      companyId,
      ...(filters.accountId ? [filters.accountId] : []),
    );

    return {
      letterings: filtered.map((r) => this.toLetteringSummary(r)),
      pagination: {
        page,
        pageSize,
        total: Number(totalCountRows[0].count),
        totalPages: Math.max(1, Math.ceil(Number(totalCountRows[0].count) / pageSize)),
      },
    };
  }

  async get(companyId: string, letteringId: string) {
    const lettering = await this.prisma.lettering.findUnique({
      where: { id: letteringId },
      include: {
        account: { select: { id: true, code: true, label: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        canceledBy: { select: { id: true, firstName: true, lastName: true } },
        lines: {
          include: {
            entry: { select: { entryNumber: true, entryDate: true, label: true, journal: { select: { code: true } } } },
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });
    if (!lettering || lettering.companyId !== companyId) {
      throw new NotFoundException('Lettrage introuvable pour cette entreprise.');
    }

    const totalDebit = lettering.lines.filter((l: any) => l.side === 'DEBIT').reduce((s: number, l: any) => s + Number(l.amount), 0);
    const totalCredit = lettering.lines.filter((l: any) => l.side === 'CREDIT').reduce((s: number, l: any) => s + Number(l.amount), 0);

    return {
      id: lettering.id,
      code: lettering.code,
      account: lettering.account,
      status: this.deriveStatus(lettering.isBalanced, lettering.canceledAt),
      createdAt: lettering.createdAt,
      createdBy: lettering.createdBy,
      canceledAt: lettering.canceledAt,
      canceledBy: lettering.canceledBy,
      totalDebit,
      totalCredit,
      difference: Math.round((totalDebit - totalCredit) * 100) / 100,
      lines: lettering.lines.map((l: any) => ({
        id: l.id,
        entryNumber: l.entry.entryNumber,
        entryDate: l.entry.entryDate,
        entryLabel: l.entry.label,
        journalCode: l.entry.journal.code,
        lineLabel: l.label,
        debit: l.side === 'DEBIT' ? Number(l.amount) : 0,
        credit: l.side === 'CREDIT' ? Number(l.amount) : 0,
      })),
    };
  }

  // =====================================================================
  // CRÉATION
  // =====================================================================

  async create(companyId: string, userId: string, dto: CreateLetteringDto, meta: RequestMetadata) {
    const account = await this.getAccountOrThrow(companyId, dto.accountId);
    if (!account.isPostable) {
      throw new BadRequestException('Ce compte est un compte de regroupement — il ne peut pas être lettré.');
    }
    // Le lettrage est réservé aux comptes de tiers — identifiés via la
    // métadonnée du référentiel comptable (AccountClass, classe "4" —
    // "Comptes de tiers", déjà seedée à l'Étape 6), jamais via un code
    // de compte codé en dur (401/411/...). Cette restriction est
    // volontairement stricte : un compte de charge, de produit ou de
    // trésorerie ne peut jamais être lettré, même s'il est postable.
    if (account.accountClass.code !== '4') {
      throw new BadRequestException(
        `Le lettrage est réservé aux comptes de tiers (classe "${account.accountClass.name}" trouvée, classe "4 — Comptes de tiers" attendue).`,
      );
    }

    // Validation complète des lignes AVANT toute écriture : existence,
    // entreprise, compte, statut d'écriture, non déjà lettrées. Le
    // montant total n'est JAMAIS accepté depuis le client — recalculé
    // ici depuis les lignes réellement trouvées en base.
    const lines: Array<{ id: string; side: string; amount: any; accountId: string; companyId: string; entryStatus: string }> =
      await this.prisma.$queryRaw`
        SELECT l.id, l.side, l.amount, l.account_id AS "accountId", l.company_id AS "companyId", e.status AS "entryStatus"
        FROM accounting_entry_lines l
        JOIN accounting_entries e ON e.id = l.entry_id
        WHERE l.id = ANY(${dto.lineIds}::text[])
      `;

    if (lines.length !== dto.lineIds.length) {
      throw new BadRequestException('Une ou plusieurs lignes sélectionnées sont introuvables.');
    }
    for (const line of lines) {
      if (line.companyId !== companyId) {
        throw new BadRequestException('Une ligne sélectionnée n\'appartient pas à cette entreprise.');
      }
      if (line.accountId !== dto.accountId) {
        throw new BadRequestException('Toutes les lignes d\'un lettrage doivent appartenir au même compte.');
      }
      if (line.entryStatus === 'DRAFT') {
        throw new BadRequestException('Une ligne d\'une écriture en brouillon ne peut pas être lettrée.');
      }
    }

    // Non déjà lettrées (vérification séparée pour un message clair)
    const alreadyLettered: Array<{ id: string }> = await this.prisma.$queryRaw`
      SELECT id FROM accounting_entry_lines WHERE id = ANY(${dto.lineIds}::text[]) AND lettering_id IS NOT NULL
    `;
    if (alreadyLettered.length > 0) {
      throw new ConflictException('Une ou plusieurs lignes sélectionnées sont déjà lettrées.');
    }

    const totalDebit = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + Number(l.amount), 0);
    const totalCredit = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s + Number(l.amount), 0);
    if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
      throw new BadRequestException(
        `Sélection déséquilibrée : débit ${totalDebit} ≠ crédit ${totalCredit}. Le reliquat reste disponible pour un futur lettrage.`,
      );
    }

    const lettering = await this.prisma.$transaction(async (tx: any) => {
      const codeRows: Array<{ number: string }> = await tx.$queryRaw`
        SELECT fn_next_document_number(${companyId}, 'LETTERING'::"SequenceDocumentType", ${dto.accountId}) as number
      `;
      const code = `A${codeRows[0].number}`;

      const created = await tx.lettering.create({
        data: { companyId, accountId: dto.accountId, code, createdById: userId, isBalanced: false },
      });

      // UPDATE ciblé (ANY + verrous implicites de ligne PostgreSQL) —
      // condition WHERE lettering_id IS NULL revérifiée ici en base
      // pour empêcher toute course : si une autre transaction
      // concurrente a lettré une de ces lignes entre-temps, moins de
      // lignes seront affectées que prévu et le contrôle ci-dessous le
      // détecte (voir §12 — concurrence).
      const result: { count: number } = await tx.$executeRaw`
        UPDATE accounting_entry_lines
        SET lettering_id = ${created.id}
        WHERE id = ANY(${dto.lineIds}::text[])
          AND company_id = ${companyId}
          AND account_id = ${dto.accountId}
          AND lettering_id IS NULL
      `;
      if (Number(result) !== dto.lineIds.length) {
        // Une ligne a été lettrée entre-temps par une autre requête —
        // on annule toute la transaction (aucun état incohérent, aucun
        // lettrage partiellement enregistré).
        throw new ConflictException(
          'Une ou plusieurs lignes sélectionnées viennent d\'être lettrées par une autre opération. Veuillez réessayer.',
        );
      }

      return created;
    });

    await this.audit('CREATE', userId, companyId, 'Lettering', lettering.id, null, { code: lettering.code, lineCount: dto.lineIds.length }, meta);
    return this.get(companyId, lettering.id);
  }

  // =====================================================================
  // CLÔTURE
  // =====================================================================

  async close(companyId: string, letteringId: string, userId: string, meta: RequestMetadata) {
    const lettering = await this.getLetteringOrThrow(companyId, letteringId);
    if (lettering.canceledAt) {
      throw new ConflictException('Ce lettrage a été délettré, il ne peut pas être clôturé.');
    }
    if (lettering.isBalanced) {
      throw new ConflictException('Ce lettrage est déjà clôturé.');
    }

    // Recalcul depuis la base — jamais depuis un total envoyé par le
    // client. Le trigger fn_check_lettering_balance (Étape 3) refait ce
    // même contrôle indépendamment au niveau SQL et rejette la
    // transaction en cas de divergence — dernière barrière.
    const sumRows: Array<{ sum: string; count: string }> = await this.prisma.$queryRaw`
      SELECT COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END), 0)::text AS sum, COUNT(*)::text AS count
      FROM accounting_entry_lines WHERE lettering_id = ${letteringId}
    `;
    const sum = Number(sumRows[0].sum);
    const count = Number(sumRows[0].count);
    if (count < 2) {
      throw new BadRequestException('Un lettrage doit comporter au moins deux lignes.');
    }
    if (Math.round(sum * 100) !== 0) {
      throw new BadRequestException(`Lettrage déséquilibré (écart : ${sum}) — clôture refusée.`);
    }

    try {
      await this.prisma.lettering.update({ where: { id: letteringId }, data: { isBalanced: true } });
    } catch (err: any) {
      if (err?.code === 'P0001' || /déséquilibré/i.test(err?.message ?? '')) {
        throw new BadRequestException('Lettrage déséquilibré (rejeté par la contrainte de base de données).');
      }
      throw err;
    }

    await this.audit('LETTERING', userId, companyId, 'Lettering', letteringId, { isBalanced: false }, { isBalanced: true }, meta);
    return this.get(companyId, letteringId);
  }

  // =====================================================================
  // DÉLETTRAGE
  // =====================================================================

  async unletter(companyId: string, letteringId: string, userId: string, meta: RequestMetadata) {
    const lettering = await this.getLetteringOrThrow(companyId, letteringId);
    if (lettering.canceledAt) {
      throw new ConflictException('Ce lettrage a déjà été délettré.');
    }

    await this.prisma.$transaction(async (tx: any) => {
      // Détache toutes les lignes — ne modifie NI le montant, NI le
      // sens, NI le compte, NI la date de l'écriture : seul le
      // rattachement au lettrage change (autorisé par le trigger
      // modifié à cette étape, voir en-tête de ce fichier).
      await tx.$executeRaw`
        UPDATE accounting_entry_lines SET lettering_id = NULL WHERE lettering_id = ${letteringId}
      `;
      await tx.lettering.update({
        where: { id: letteringId },
        data: { canceledAt: new Date(), canceledById: userId, isBalanced: false },
      });
    });

    await this.audit('UNLETTERING', userId, companyId, 'Lettering', letteringId, { canceledAt: null }, { canceledAt: new Date() }, meta);
    return this.get(companyId, letteringId);
  }

  // =====================================================================
  // SUGGESTIONS AUTOMATIQUES (lecture seule, aucune écriture)
  // =====================================================================

  async suggestions(companyId: string, accountId: string) {
    await this.getAccountOrThrow(companyId, accountId);

    const lines: Array<{ id: string; side: 'DEBIT' | 'CREDIT'; amount: any; entry_number: string; entry_label: string; entry_date: Date }> =
      await this.prisma.$queryRaw`
        SELECT l.id, l.side, l.amount, e.entry_number, e.label AS entry_label, e.entry_date
        FROM accounting_entry_lines l
        JOIN accounting_entries e ON e.id = l.entry_id
        WHERE l.company_id = ${companyId} AND l.account_id = ${accountId}
          AND l.lettering_id IS NULL AND e.status <> 'DRAFT'
        ORDER BY e.entry_date ASC
      `;

    const debits = lines.filter((l) => l.side === 'DEBIT').map((l) => ({ ...l, amount: Number(l.amount) }));
    const credits = lines.filter((l) => l.side === 'CREDIT').map((l) => ({ ...l, amount: Number(l.amount) }));
    const usedCreditIds = new Set<string>();
    const suggestions: Array<{
      debitLines: any[];
      creditLines: any[];
      totalDebit: number;
      totalCredit: number;
      difference: number;
      confidence: 'forte' | 'moyenne';
    }> = [];

    // Étape 1 : correspondances exactes 1↔1 (confiance forte).
    for (const debit of debits) {
      const match = credits.find((c) => !usedCreditIds.has(c.id) && Math.round(c.amount * 100) === Math.round(debit.amount * 100));
      if (match) {
        usedCreditIds.add(match.id);
        suggestions.push({
          debitLines: [this.toSuggestionLine(debit)],
          creditLines: [this.toSuggestionLine(match)],
          totalDebit: debit.amount,
          totalCredit: match.amount,
          difference: 0,
          confidence: 'forte',
        });
      }
    }

    // Étape 2 : correspondances multi-lignes (une facture, plusieurs
    // règlements partiels dont la somme égale exactement le débit) —
    // recherche limitée à de petites combinaisons (jusqu'à 3 crédits)
    // pour rester performante ; confiance moyenne, jamais présentée
    // comme certaine (§27 : "Suggestion forte", jamais "confirmé").
    const remainingDebits = debits.filter((d) => !suggestions.some((s) => s.debitLines[0].id === d.id));
    const remainingCredits = credits.filter((c) => !usedCreditIds.has(c.id));
    for (const debit of remainingDebits) {
      const combo = this.findCombinationSum(remainingCredits.filter((c) => !usedCreditIds.has(c.id)), debit.amount, 3);
      if (combo) {
        combo.forEach((c) => usedCreditIds.add(c.id));
        suggestions.push({
          debitLines: [this.toSuggestionLine(debit)],
          creditLines: combo.map((c) => this.toSuggestionLine(c)),
          totalDebit: debit.amount,
          totalCredit: combo.reduce((s, c) => s + c.amount, 0),
          difference: 0,
          confidence: 'moyenne',
        });
      }
    }

    return { accountId, suggestions };
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private findCombinationSum(items: Array<{ amount: number }>, target: number, maxSize: number): any[] | null {
    const targetCents = Math.round(target * 100);
    const n = Math.min(items.length, 12); // borne la combinatoire (12 éléments max explorés)
    const candidates = items.slice(0, n);

    function search(index: number, remaining: number, chosen: any[]): any[] | null {
      if (remaining === 0 && chosen.length >= 1) return chosen;
      if (index >= candidates.length || chosen.length >= maxSize) return null;
      // Essaye d'inclure l'élément courant
      const withItem = search(index + 1, remaining - Math.round(candidates[index].amount * 100), [...chosen, candidates[index]]);
      if (withItem) return withItem;
      // Essaye sans l'élément courant
      return search(index + 1, remaining, chosen);
    }

    return search(0, targetCents, []);
  }

  private toSuggestionLine(line: any) {
    return { id: line.id, amount: line.amount, entryNumber: line.entry_number, entryLabel: line.entry_label, entryDate: line.entry_date };
  }

  private deriveStatus(isBalanced: boolean, canceledAt: Date | null): 'OPEN' | 'CLOSED' | 'CANCELED' {
    if (canceledAt) return 'CANCELED';
    return isBalanced ? 'CLOSED' : 'OPEN';
  }

  private toLetteringSummary(r: any) {
    return {
      id: r.id,
      code: r.code,
      account: { id: r.account_id, code: r.account_code, label: r.account_label },
      status: this.deriveStatus(r.is_balanced, r.canceled_at),
      createdAt: r.created_at,
      createdBy: { firstName: r.created_by_first, lastName: r.created_by_last },
      totalDebit: Number(r.total_debit),
      totalCredit: Number(r.total_credit),
      difference: Math.round((Number(r.total_debit) - Number(r.total_credit)) * 100) / 100,
      lineCount: Number(r.line_count),
    };
  }

  private async getAccountOrThrow(companyId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, include: { accountClass: true } });
    if (!account || account.companyId !== companyId) {
      throw new NotFoundException('Compte introuvable pour cette entreprise.');
    }
    return account;
  }

  private async getLetteringOrThrow(companyId: string, letteringId: string) {
    const lettering = await this.prisma.lettering.findUnique({ where: { id: letteringId } });
    if (!lettering || lettering.companyId !== companyId) {
      throw new NotFoundException('Lettrage introuvable pour cette entreprise.');
    }
    return lettering;
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
