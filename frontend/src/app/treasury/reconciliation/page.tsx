'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../lib/auth-context';
import { useCompany } from '../../../lib/company-context';
import { apiClient } from '../../../lib/api-client';

interface BankAccountOption {
  id: string;
  code: string;
  name: string;
}

interface Reconciliation {
  id: string;
  periodStart: string;
  periodEnd: string;
  statementBalance: string;
  bookBalance: string;
  status: string;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ReconciliationContent() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get('bankAccountId');

  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState(preselected ?? '');
  const [reconciliations, setReconciliations] = useState<Reconciliation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [statementBalance, setStatementBalance] = useState('0');
  const [isCreating, setIsCreating] = useState(false);

  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; warnings: string[] } | null>(null);
  const [importErrors, setImportErrors] = useState<Array<{ line: number; message: string }> | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      apiClient.get(`/companies/${currentCompanyId}/bank-accounts`).then(({ data }) => setBankAccounts(data));
    }
  }, [authLoading, isAuthenticated, currentCompanyId, router]);

  async function loadReconciliations() {
    if (!bankAccountId || !currentCompanyId) return;
    try {
      const { data } = await apiClient.get(`/companies/${currentCompanyId}/bank-accounts/${bankAccountId}/reconciliations`);
      setReconciliations(data);
    } catch {
      setError('Impossible de charger les rapprochements (permission RECONCILIATION.READ requise).');
    }
  }

  useEffect(() => {
    if (bankAccountId) loadReconciliations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/bank-accounts/${bankAccountId}/reconciliations`, {
        periodStart,
        periodEnd,
        statementBalance: parseFloat(statementBalance) || 0,
      });
      router.push(`/treasury/reconciliation/${data.id}`);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.message) {
        setError(Array.isArray(err.response.data.message) ? err.response.data.message.join(' ') : err.response.data.message);
      } else {
        setError('Une erreur est survenue.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setImportResult(null);
    setImportErrors(null);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(reader.result as string);
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!csvContent || !bankAccountId) return;
    setIsImporting(true);
    setImportErrors(null);
    setImportResult(null);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/bank-accounts/${bankAccountId}/statement-import`, { csvContent });
      if (data.errors && data.errors.length > 0) {
        setImportErrors(data.errors);
      } else {
        setImportResult({ imported: data.imported, warnings: data.warnings ?? [] });
        setCsvContent(null);
        setCsvFileName(null);
      }
    } catch {
      setError("Échec de l'import.");
    } finally {
      setIsImporting(false);
    }
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 900, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Rapprochement bancaire</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="bankAccountId">Compte bancaire</label>
        <br />
        <select id="bankAccountId" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
          <option value="">— choisir —</option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </div>

      {bankAccountId && (
        <>
          <h2>Importer un relevé (CSV)</h2>
          <p style={{ fontSize: '0.9em' }}>
            Format attendu : <code>date;label;reference;amount;side</code> (side = CREDIT ou DEBIT)
          </p>
          <input type="file" accept=".csv,text/csv" onChange={handleFileSelect} />
          {csvFileName && (
            <div>
              <p>
                Fichier : <strong>{csvFileName}</strong> — {csvContent?.split(/\r?\n/).filter((l) => l.trim()).length ?? 0} ligne(s)
              </p>
              <pre style={{ background: '#f5f5f5', padding: '0.5rem', maxHeight: 150, overflow: 'auto' }}>{csvContent}</pre>
              <button onClick={handleImport} disabled={isImporting}>
                {isImporting ? 'Import…' : "Confirmer l'import"}
              </button>
            </div>
          )}
          {importResult && (
            <p style={{ color: 'green' }}>
              {importResult.imported} ligne(s) importée(s).
              {importResult.warnings.length > 0 && ` ${importResult.warnings.length} ignorée(s) (doublons).`}
            </p>
          )}
          {importErrors && (
            <div style={{ color: 'red' }}>
              <p>Erreurs — aucune ligne importée :</p>
              <ul>
                {importErrors.map((e, i) => (
                  <li key={i}>
                    Ligne {e.line} : {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h2>Nouvelle session de rapprochement</h2>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label htmlFor="periodStart">Début</label>
                <br />
                <input id="periodStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="periodEnd">Fin</label>
                <br />
                <input id="periodEnd" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
              </div>
              <div>
                <label htmlFor="statementBalance">Solde du relevé</label>
                <br />
                <input id="statementBalance" type="number" step="0.01" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} required />
              </div>
            </div>
            <button type="submit" disabled={isCreating}>
              {isCreating ? 'Création…' : 'Créer la session de rapprochement'}
            </button>
          </form>

          <h2>Sessions existantes</h2>
          {reconciliations === null ? (
            <p>Chargement…</p>
          ) : reconciliations.length === 0 ? (
            <p style={{ fontStyle: 'italic' }}>Aucune session.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Période</th>
                  <th align="right">Solde relevé</th>
                  <th align="right">Solde livre</th>
                  <th align="left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/treasury/reconciliation/${r.id}`)}>
                    <td>
                      {r.periodStart.slice(0, 10)} → {r.periodEnd.slice(0, 10)}
                    </td>
                    <td align="right">{fmt(Number(r.statementBalance))}</td>
                    <td align="right">{fmt(Number(r.bookBalance))}</td>
                    <td>{r.status === 'IN_PROGRESS' ? 'En cours' : r.status === 'COMPLETED' ? 'Clôturé' : 'Annulé'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <p style={{ marginTop: '1.5rem' }}>
        <a href="/treasury/banks">Retour aux comptes bancaires</a>
      </p>
    </main>
  );
}

export default function ReconciliationPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 900, margin: '4rem auto' }}>Chargement…</main>}>
      <ReconciliationContent />
    </Suspense>
  );
}
