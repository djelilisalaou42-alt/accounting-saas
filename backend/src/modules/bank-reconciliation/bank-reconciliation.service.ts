import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReconciliationDto, ImportStatementDto, MatchLinesDto } from './dto/reconciliation.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * MODÈLE DE DONNÉES (Étape 11, Phase 8-10) — réutilise intégralement
 * `BankTransaction` (Étape 2) pour représenter à la fois :
 *   - les mouvements du LIVRE (source=BOOK, toujours liés à une
 *     écriture comptable validée, générés par le module `bank`) ;
 *   - les lignes IMPORTÉES du relevé (source=STATEMENT, jamais liées à
 *     une écriture — en attente de pointage).
 * Le pointage lui-même est une table de jonction dédiée
 * (`BankReconciliationMatch`, migration Étape 11) permettant un
 * rapprochement plusieurs-à-plusieurs, sans jamais modifier les
 * `BankTransaction`/`AccountingEntry` sous-jacents — le rapprochement
 * est une information complémentaire, jamais une altération d'une
 * écriture validée.
 * =====================================================================
 */
@Injectable()
export class BankReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================================
  // SESSIONS DE RAPPROCHEMENT
  // =====================================================================

  async list(companyId: string, bankAccountId: string) {
    await this.getBankAccountOrThrow(companyId, bankAccountId);
    return this.prisma.bankReconciliation.findMany({ where: { companyId, bankAccountId }, orderBy: { createdAt: 'desc' } });
  }

  async get(companyId: string, id: string) {
    const rec = await this.getReconciliationOrThrow(companyId, id, {
      matches: { include: { statementTransaction: true, bookTransaction: true } },
    });
    return rec;
  }

  async create(companyId: string, bankAccountId: string, userId: string, dto: CreateReconciliationDto, meta: RequestMetadata) {
    const bank = await this.getBankAccountOrThrow(companyId, bankAccountId);
    const periodEnd = new Date(dto.periodEnd);

    const rows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId} AND l.account_id = ${bank.accountId} AND e.status <> 'DRAFT' AND e.entry_date <= ${periodEnd}
    `;
    const bookBalance = Number(rows[0].debit) - Number(rows[0].credit);

    const rec = await this.prisma.bankReconciliation.create({
      data: {
        bankAccountId,
        companyId,
        periodStart: new Date(dto.periodStart),
        periodEnd,
        statementBalance: dto.statementBalance,
        bookBalance,
        status: 'IN_PROGRESS',
        createdById: userId,
      },
    });
    await this.audit('CREATE', userId, companyId, 'BankReconciliation', rec.id, null, { bankAccountId, statementBalance: dto.statementBalance }, meta);
    return rec;
  }

  async complete(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const rec = await this.getReconciliationOrThrow(companyId, id);
    if (rec.status !== 'IN_PROGRESS') throw new ConflictException('Seul un rapprochement en cours peut être clôturé.');

    // Recalcul du solde livre au moment de la clôture — jamais depuis
    // une valeur mise en cache côté client.
    const rows: Array<{ debit: string; credit: string }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
      FROM accounting_entry_lines l
      JOIN accounting_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId} AND l.account_id = ${(await this.getBankAccountOrThrow(companyId, rec.bankAccountId)).accountId}
        AND e.status <> 'DRAFT' AND e.entry_date <= ${rec.periodEnd}
    `;
    const bookBalance = Number(rows[0].debit) - Number(rows[0].credit);
    const balanced = Math.round((bookBalance - Number(rec.statementBalance)) * 100) === 0;

    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date(), bookBalance },
    });
    await this.audit('UPDATE', userId, companyId, 'BankReconciliation', id, { status: 'IN_PROGRESS' }, { status: 'COMPLETED', balanced }, meta);
    return { ...updated, balanced };
  }

    async cancel(companyId: string, id: string, userId: string, meta: RequestMetadata) {
    const rec = await this.prisma.bankReconciliation.findUnique({
      where: { id },
      include: { matches: true },
    });
    if (!rec || rec.companyId !== companyId) {
      throw new NotFoundException('Rapprochement introuvable pour cette entreprise.');
    }
    if (rec.status === 'CANCELED') throw new ConflictException('Ce rapprochement est déjà annulé.');

    await this.prisma.$transaction(async (tx: any) => {
      // Dé-pointage complet — ne modifie jamais AccountingEntry, ne
      // fait que retirer le rattachement de rapprochement (même
      // principe que le délettrage, Étape 9).
      const transactionIds = new Set<string>();
      for (const m of rec.matches) {
        transactionIds.add(m.statementTransactionId);
        transactionIds.add(m.bookTransactionId);
      }
      if (transactionIds.size > 0) {
        await tx.bankTransaction.updateMany({ where: { id: { in: [...transactionIds] } }, data: { isReconciled: false, reconciliationId: null } });
      }
      await tx.bankReconciliationMatch.deleteMany({ where: { reconciliationId: id } });
      await tx.bankReconciliation.update({ where: { id }, data: { status: 'CANCELED', canceledAt: new Date(), canceledById: userId } });
    });

    await this.audit('UPDATE', userId, companyId, 'BankReconciliation', id, { status: rec.status }, { status: 'CANCELED' }, meta);
    return this.get(companyId, id);
  }

  // =====================================================================
  // LIGNES NON RAPPROCHÉES
  // =====================================================================

  async listUnmatchedStatementLines(companyId: string, bankAccountId: string) {
    await this.getBankAccountOrThrow(companyId, bankAccountId);
    return this.prisma.bankTransaction.findMany({
      where: { companyId, bankAccountId, source: 'STATEMENT', isReconciled: false },
      orderBy: { transactionDate: 'asc' },
    });
  }

  async listUnmatchedBookMovements(companyId: string, bankAccountId: string) {
    await this.getBankAccountOrThrow(companyId, bankAccountId);
    return this.prisma.bankTransaction.findMany({
      where: { companyId, bankAccountId, source: 'BOOK', isReconciled: false },
      orderBy: { transactionDate: 'asc' },
    });
  }

  // =====================================================================
  // POINTAGE — sûr en concurrence (verrouillage explicite des deux
  // lignes avant vérification, même principe que le lettrage Étape 9
  // et l'affectation de paiement Étape 10).
  // =====================================================================

  async matchLines(companyId: string, reconciliationId: string, userId: string, dto: MatchLinesDto, meta: RequestMetadata) {
    const rec = await this.getReconciliationOrThrow(companyId, reconciliationId);
    if (rec.status !== 'IN_PROGRESS') throw new ConflictException('Seul un rapprochement en cours accepte de nouveaux pointages.');

    let match;
    try {
      match = await this.prisma.$transaction(async (tx: any) => {
        const rows: any[] = await tx.$queryRaw`
          SELECT id, company_id, bank_account_id, source, is_reconciled, amount, type
          FROM bank_transactions WHERE id IN (${dto.statementTransactionId}, ${dto.bookTransactionId}) FOR UPDATE
        `;
        const statementLine = rows.find((r: any) => r.id === dto.statementTransactionId);
        const bookLine = rows.find((r: any) => r.id === dto.bookTransactionId);
        if (!statementLine || !bookLine) throw new NotFoundException('Ligne introuvable.');
        if (statementLine.company_id !== companyId || bookLine.company_id !== companyId) throw new NotFoundException('Ligne introuvable pour cette entreprise.');
        if (statementLine.bank_account_id !== rec.bankAccountId || bookLine.bank_account_id !== rec.bankAccountId) {
          throw new BadRequestException('Les deux lignes doivent appartenir au compte bancaire de ce rapprochement.');
        }
        if (statementLine.source !== 'STATEMENT') throw new BadRequestException('La première ligne doit être une ligne de relevé importée.');
        if (bookLine.source !== 'BOOK') throw new BadRequestException('La seconde ligne doit être un mouvement du livre.');
        if (statementLine.is_reconciled) throw new ConflictException('Cette ligne de relevé est déjà rapprochée.');
        if (bookLine.is_reconciled) throw new ConflictException('Ce mouvement du livre est déjà rapproché.');

        const created = await tx.bankReconciliationMatch.create({
          data: { reconciliationId, companyId, statementTransactionId: dto.statementTransactionId, bookTransactionId: dto.bookTransactionId },
        });
        await tx.bankTransaction.updateMany({ where: { id: { in: [dto.statementTransactionId, dto.bookTransactionId] } }, data: { isReconciled: true, reconciliationId } });
        return created;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new ConflictException('Ces deux lignes sont déjà pointées ensemble.');
      throw err;
    }

    await this.audit('UPDATE', userId, companyId, 'BankReconciliation', reconciliationId, null, { matched: [dto.statementTransactionId, dto.bookTransactionId] }, meta);
    return match;
  }

  async unmatchLines(companyId: string, reconciliationId: string, matchId: string, userId: string, meta: RequestMetadata) {
    const rec = await this.getReconciliationOrThrow(companyId, reconciliationId);
    if (rec.status !== 'IN_PROGRESS') throw new ConflictException('Seul un rapprochement en cours accepte un dé-pointage.');
    const match = await this.prisma.bankReconciliationMatch.findUnique({ where: { id: matchId } });
    if (!match || match.reconciliationId !== reconciliationId) throw new NotFoundException('Pointage introuvable.');

    await this.prisma.$transaction(async (tx: any) => {
      await tx.bankTransaction.updateMany({ where: { id: { in: [match.statementTransactionId, match.bookTransactionId] } }, data: { isReconciled: false, reconciliationId: null } });
      await tx.bankReconciliationMatch.delete({ where: { id: matchId } });
    });

    await this.audit('UPDATE', userId, companyId, 'BankReconciliation', reconciliationId, null, { unmatched: matchId }, meta);
  }

  // =====================================================================
  // IMPORT CSV (Phase 9) — transactionnel, jamais de doublon, jamais
  // le contenu complet loggé.
  // =====================================================================

  async importStatement(companyId: string, bankAccountId: string, userId: string, dto: ImportStatementDto, meta: RequestMetadata) {
    await this.getBankAccountOrThrow(companyId, bankAccountId);

    const lines = dto.csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new BadRequestException('Fichier CSV vide ou invalide.');
    const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
    const idx = { date: header.indexOf('date'), label: header.indexOf('label'), reference: header.indexOf('reference'), amount: header.indexOf('amount'), side: header.indexOf('side') };
    if (idx.date === -1 || idx.label === -1 || idx.amount === -1 || idx.side === -1) {
      throw new BadRequestException('Colonnes attendues : date;label;reference;amount;side (CREDIT/DEBIT).');
    }

    const rows = lines.slice(1);
    const parsed: Array<{ lineNumber: number; date: string; label: string; reference: string | null; amount: number; side: string }> = [];
    const errors: Array<{ line: number; message: string }> = [];

    rows.forEach((line, i) => {
      const cols = line.split(';').map((c) => c.trim());
      const lineNumber = i + 2;
      const date = cols[idx.date];
      const label = cols[idx.label];
      const reference = idx.reference >= 0 ? cols[idx.reference] || null : null;
      const amountRaw = cols[idx.amount];
      const side = (cols[idx.side] || '').toUpperCase();

      if (!date || Number.isNaN(Date.parse(date))) { errors.push({ line: lineNumber, message: 'Date invalide.' }); return; }
      if (!label) { errors.push({ line: lineNumber, message: 'Libellé manquant.' }); return; }
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount) || amount <= 0) { errors.push({ line: lineNumber, message: 'Montant invalide (doit être positif).' }); return; }
      if (side !== 'CREDIT' && side !== 'DEBIT') { errors.push({ line: lineNumber, message: 'Sens invalide (CREDIT ou DEBIT attendu).' }); return; }

      parsed.push({ lineNumber, date, label, reference, amount, side });
    });

    if (errors.length > 0) {
      return { imported: 0, errors, warnings: [] };
    }

    // Détection de doublons contre les lignes déjà importées (même
    // compte, même date, même montant, même référence).
    const existing = await this.prisma.bankTransaction.findMany({
      where: { companyId, bankAccountId, source: 'STATEMENT' },
      select: { transactionDate: true, amount: true, reference: true },
    });
    const existingKeys = new Set(existing.map((e: any) => `${e.transactionDate.toISOString().slice(0, 10)}|${Number(e.amount)}|${e.reference ?? ''}`));

    const warnings: string[] = [];
    const toImport = parsed.filter((p) => {
      const key = `${p.date}|${p.amount}|${p.reference ?? ''}`;
      if (existingKeys.has(key)) {
        warnings.push(`Ligne ${p.lineNumber} ignorée (doublon détecté : même date/montant/référence déjà importés).`);
        return false;
      }
      return true;
    });

    let imported = 0;
    if (toImport.length > 0) {
      await this.prisma.$transaction(async (tx: any) => {
        for (const line of toImport) {
          await tx.bankTransaction.create({
            data: {
              bankAccountId,
              companyId,
              type: line.side,
              source: 'STATEMENT',
              amount: line.amount,
              transactionDate: new Date(line.date),
              label: line.label,
              reference: line.reference,
            },
          });
          imported++;
        }
      });
    }

    // Jamais le contenu complet du fichier dans l'audit — seulement
    // les métriques (Étape 11, Phase 9/12).
    await this.audit('CREATE', userId, companyId, 'BankStatementImport', bankAccountId, null, { imported, skipped: warnings.length, totalLines: parsed.length }, meta);
    return { imported, errors: [], warnings };
  }

  // =====================================================================
  // SUGGESTIONS AUTOMATIQUES (Phase 10) — lecture seule.
  // =====================================================================

  async suggestMatches(companyId: string, bankAccountId: string) {
    await this.getBankAccountOrThrow(companyId, bankAccountId);
    const [statementLines, bookLines] = await Promise.all([
      this.listUnmatchedStatementLines(companyId, bankAccountId),
      this.listUnmatchedBookMovements(companyId, bankAccountId),
    ]);

    const TOLERANCE_DAYS = 5;
    const usedBookIds = new Set<string>();
    const suggestions: Array<{ statementTransactionId: string; bookTransactionId: string; confidence: 'forte' | 'moyenne'; reason: string }> = [];

    for (const stmt of statementLines) {
      const candidates = bookLines.filter(
        (b: any) =>
          !usedBookIds.has(b.id) &&
          b.type === stmt.type &&
          Math.round(Number(b.amount) * 100) === Math.round(Number(stmt.amount) * 100),
      );
      if (candidates.length === 0) continue;

      // Correspondance exacte de référence -> confiance forte.
      const exactRef = candidates.find((b: any) => stmt.reference && b.reference && b.reference === stmt.reference);
      if (exactRef) {
        usedBookIds.add(exactRef.id);
        suggestions.push({ statementTransactionId: stmt.id, bookTransactionId: exactRef.id, confidence: 'forte', reason: 'Montant et référence identiques' });
        continue;
      }

      // Sinon, montant identique + date proche -> confiance moyenne.
      const closeInDate = candidates
        .map((b: any) => ({ b, diffDays: Math.abs((new Date(b.transactionDate).getTime() - new Date(stmt.transactionDate).getTime()) / 86400000) }))
        .filter((c: any) => c.diffDays <= TOLERANCE_DAYS)
        .sort((a: any, c: any) => a.diffDays - c.diffDays)[0];
      if (closeInDate) {
        usedBookIds.add(closeInDate.b.id);
        suggestions.push({ statementTransactionId: stmt.id, bookTransactionId: closeInDate.b.id, confidence: 'moyenne', reason: `Montant identique, écart de ${Math.round(closeInDate.diffDays)} jour(s)` });
      }
    }

    return { suggestions };
  }

  // =====================================================================
  // Utilitaires
  // =====================================================================

  private async getBankAccountOrThrow(companyId: string, bankAccountId: string) {
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!bank || bank.companyId !== companyId) throw new NotFoundException('Compte bancaire introuvable pour cette entreprise.');
    return bank;
  }

  private async getReconciliationOrThrow(companyId: string, id: string, include?: any) {
    const rec = await this.prisma.bankReconciliation.findUnique({ where: { id }, include });
    if (!rec || rec.companyId !== companyId) throw new NotFoundException('Rapprochement introuvable pour cette entreprise.');
    return rec;
  }

  private async audit(action: string, userId: string, companyId: string, entityType: string, entityId: string, oldValue: unknown, newValue: unknown, meta: RequestMetadata): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { userId, companyId, action: action as any, entityType, entityId, oldValue: oldValue as any, newValue: newValue as any, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      });
    } catch {
      // best-effort
    }
  }
}
