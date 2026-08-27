'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../../lib/auth-context';
import { useCompany } from '../../../../../lib/company-context';
import { apiClient } from '../../../../../lib/api-client';
import { AttachmentsPanel } from '../../../../../components/shared/AttachmentsPanel';

interface DeclarationDetail {
  id: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'PAID' | 'LATE';
  taxableBase: string;
  collectedAmount: string;
  deductibleAmount: string;
  netAmount: string;
  amountDue: string;
  amountPaid: string;
  creditAmount: string;
  validatedAt: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  tax: { code: string; label: string; rate: string };
  linkedEntry: { entryNumber: string; status: string } | null;
}

const STATUS_LABELS: Record<string, string> = { DRAFT: 'Brouillon', SUBMITTED: 'Soumise', PAID: 'Payée', LATE: 'En retard' };

function fmt(n: string | number): string {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TaxDeclarationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();

  const [declaration, setDeclaration] = useState<DeclarationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));

  async function load() {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<DeclarationDetail>(`/companies/${currentCompanyId}/tax-declarations/${params.id}`);
      setDeclaration(data);
    } catch {
      setError('Déclaration introuvable.');
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated, currentCompanyId, params.id]);

  async function runAction(path: string) {
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/tax-declarations/${params.id}/${path}`);
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setActionError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setActionError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePayment(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setIsSaving(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/tax-declarations/${params.id}/payments`, {
        amount: parseFloat(paymentAmount) || 0,
        paymentDate,
      });
      setPaymentAmount('0');
      load();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setActionError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setActionError('Une erreur est survenue.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !declaration) {
    return (
      <main style={{ maxWidth: 700, margin: '4rem auto' }}>
        <p role="alert">{error}</p>
        <a href="/accounting/taxes/declarations">Retour</a>
      </main>
    );
  }
  if (!declaration) return <main style={{ maxWidth: 700, margin: '4rem auto' }}>Chargement…</main>;

  const soldeRestant = round2(Number(declaration.amountDue) - Number(declaration.amountPaid));

  return (
    <main style={{ maxWidth: 700, margin: '4rem auto' }}>
      <h1>
        {declaration.periodLabel} — {declaration.tax.code}
      </h1>
      {actionError && <p role="alert" style={{ color: 'red' }}>{actionError}</p>}

      <p>Statut : <strong>{STATUS_LABELS[declaration.status] ?? declaration.status}</strong></p>
      <p>Période : {declaration.periodStart.slice(0, 10)} au {declaration.periodEnd.slice(0, 10)} — Échéance : {declaration.dueDate.slice(0, 10)}</p>

      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '1rem 0' }}>
        <tbody>
          <tr><td>Base imposable</td><td align="right">{fmt(declaration.taxableBase)}</td></tr>
          <tr><td>TVA collectée</td><td align="right">{fmt(declaration.collectedAmount)}</td></tr>
          <tr><td>TVA déductible</td><td align="right">{fmt(declaration.deductibleAmount)}</td></tr>
          <tr><td>TVA nette</td><td align="right">{fmt(declaration.netAmount)}</td></tr>
          <tr><td>Montant dû</td><td align="right"><strong>{fmt(declaration.amountDue)}</strong></td></tr>
          <tr><td>Crédit de TVA reporté</td><td align="right">{fmt(declaration.creditAmount)}</td></tr>
          <tr><td>Montant payé</td><td align="right">{fmt(declaration.amountPaid)}</td></tr>
          <tr><td>Solde restant</td><td align="right"><strong>{fmt(soldeRestant)}</strong></td></tr>
        </tbody>
      </table>

      {declaration.linkedEntry && <p>Écriture générée : {declaration.linkedEntry.entryNumber} ({declaration.linkedEntry.status})</p>}

      <div style={{ margin: '1rem 0' }}>
        {declaration.status === 'DRAFT' && !declaration.validatedAt && (
          <>
            <button type="button" onClick={() => runAction('recalculate')} disabled={isSaving}>
              Recalculer
            </button>{' '}
            <button type="button" onClick={() => runAction('validate')} disabled={isSaving}>
              Valider (génère l&apos;écriture)
            </button>
          </>
        )}
        {declaration.status === 'DRAFT' && declaration.validatedAt && (
          <button type="button" onClick={() => runAction('declare')} disabled={isSaving}>
            Soumettre la déclaration
          </button>
        )}
      </div>

      {(declaration.status === 'SUBMITTED' || declaration.status === 'LATE') && soldeRestant > 0 && (
        <>
          <h2>Enregistrer un paiement</h2>
          <form onSubmit={handlePayment} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div>
              <label htmlFor="paymentAmount">Montant</label>
              <br />
              <input id="paymentAmount" type="number" min="0.01" step="0.01" max={soldeRestant} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="paymentDate">Date</label>
              <br />
              <input id="paymentDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
            </div>
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Enregistrement…' : 'Enregistrer le paiement'}
            </button>
          </form>
        </>
      )}

      <AttachmentsPanel companyId={currentCompanyId!} entityType="taxDeclaration" entityId={declaration.id} />

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/accounting/taxes/declarations">Retour aux déclarations</a>
      </p>
    </main>
  );
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
