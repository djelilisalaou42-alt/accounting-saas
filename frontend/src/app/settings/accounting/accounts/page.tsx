'use client';

import { useEffect, useState, FormEvent, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { useAuth } from '../../../../lib/auth-context';
import { useCompany } from '../../../../lib/company-context';
import { apiClient } from '../../../../lib/api-client';

interface TreeNode {
  id: string;
  code: string;
  label: string;
  level: number;
  isPostable: boolean;
  isActive: boolean;
  children: TreeNode[];
}

interface ClassGroup {
  classId: string;
  classCode: string;
  className: string;
  accounts: TreeNode[];
}

interface AccountClassOption {
  id: string;
  code: string;
  name: string;
}

function TreeItem({ node, onToggle, onSelect }: { node: TreeNode; onToggle: (id: string) => void; onSelect: (id: string) => void }) {
  return (
    <li>
      <span
        onClick={() => onSelect(node.id)}
        style={{ cursor: 'pointer', opacity: node.isActive ? 1 : 0.5, textDecoration: node.isActive ? 'none' : 'line-through' }}
      >
        {node.code} — {node.label}{' '}
        <em style={{ fontSize: '0.8em' }}>{node.isPostable ? '(mouvement)' : '(regroupement)'}</em>
      </span>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ChartOfAccountsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const router = useRouter();

  const [tree, setTree] = useState<ClassGroup[] | null>(null);
  const [classOptions, setClassOptions] = useState<AccountClassOption[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Formulaire de création
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newClassId, setNewClassId] = useState('');
  const [newIsPostable, setNewIsPostable] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  // Import CSV
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ importedCount: number } | null>(null);
  const [importErrors, setImportErrors] = useState<Array<{ line: number; code: string | null; message: string }> | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const loadTree = useCallback(async () => {
    if (!currentCompanyId) return;
    try {
      const { data } = await apiClient.get<ClassGroup[]>(`/companies/${currentCompanyId}/accounts/tree`);
      setTree(data);
    } catch {
      setError('Impossible de charger le plan comptable (permission ACCOUNT.READ requise).');
    }
  }, [currentCompanyId]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && currentCompanyId) {
      loadTree();
      apiClient.get('/accounting-frameworks').then(({ data }) => {
        const active = data.find((f: any) => f.isActive);
        if (active) setClassOptions(active.accountClasses);
      });
    }
  }, [authLoading, isAuthenticated, currentCompanyId, loadTree, router]);

  const filteredTree = useMemo(() => {
    if (!tree) return null;
    const query = search.trim().toLowerCase();

    function filterNode(node: TreeNode): TreeNode | null {
      const matches = !query || node.code.toLowerCase().includes(query) || node.label.toLowerCase().includes(query);
      const children = node.children.map(filterNode).filter((n): n is TreeNode => n !== null);
      if (matches || children.length > 0) return { ...node, children };
      return null;
    }

    return tree
      .filter((g) => !classFilter || g.classCode === classFilter)
      .map((g) => ({ ...g, accounts: g.accounts.map(filterNode).filter((n): n is TreeNode => n !== null) }));
  }, [tree, search, classFilter]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      await apiClient.post(`/companies/${currentCompanyId}/accounts`, {
        code: newCode,
        label: newLabel,
        accountClassId: newClassId,
        parentId: selectedAccountId ?? undefined,
        isPostable: newIsPostable,
      });
      setNewCode('');
      setNewLabel('');
      loadTree();
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

  async function toggleAccount(accountId: string, currentlyActive: boolean) {
    const action = currentlyActive ? 'disable' : 'enable';
    await apiClient.post(`/companies/${currentCompanyId}/accounts/${accountId}/${action}`);
    loadTree();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setImportResult(null);
    setImportErrors(null);
    const reader = new FileReader();
    // Le contenu du fichier reste en mémoire (state React), jamais
    // écrit dans un log ni dans localStorage — voir README.
    reader.onload = () => setCsvContent(reader.result as string);
    reader.readAsText(file);
  }

  async function handleImportConfirm() {
    if (!csvContent) return;
    setIsImporting(true);
    setImportErrors(null);
    setImportResult(null);
    try {
      const { data } = await apiClient.post(`/companies/${currentCompanyId}/accounts/import`, { csvContent });
      setImportResult(data);
      setCsvContent(null);
      setCsvFileName(null);
      loadTree();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data?.errors) {
        setImportErrors(err.response.data.errors);
      } else {
        setError("Échec de l'import.");
      }
    } finally {
      setIsImporting(false);
    }
  }

  if (!currentCompanyId) {
    return (
      <main style={{ maxWidth: 800, margin: '4rem auto' }}>
        <p>Sélectionnez une entreprise pour gérer son plan comptable.</p>
        <a href="/settings/accounting">Retour</a>
      </main>
    );
  }

  const selectedAccount = selectedAccountId
    ? tree?.flatMap((g) => flattenAccounts(g.accounts)).find((a) => a.id === selectedAccountId)
    : null;

  return (
    <main style={{ maxWidth: 800, margin: '4rem auto' }}>
      <h1>Plan comptable</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <input placeholder="Rechercher un code ou un libellé…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value="">Toutes les classes</option>
          {tree?.map((g) => (
            <option key={g.classId} value={g.classCode}>
              Classe {g.classCode} — {g.className}
            </option>
          ))}
        </select>
      </div>

      {filteredTree === null ? (
        <p>Chargement…</p>
      ) : (
        filteredTree.map((group) => (
          <div key={group.classId} style={{ marginBottom: '1rem' }}>
            <h3>
              Classe {group.classCode} — {group.className}
            </h3>
            {group.accounts.length === 0 ? (
              <p style={{ fontStyle: 'italic', fontSize: '0.9em' }}>Aucun compte.</p>
            ) : (
              <ul>
                {group.accounts.map((acc) => (
                  <TreeItem key={acc.id} node={acc} onToggle={() => {}} onSelect={setSelectedAccountId} />
                ))}
              </ul>
            )}
          </div>
        ))
      )}

      {selectedAccount && (
        <div style={{ border: '1px solid #ccc', padding: '0.75rem', marginBottom: '1rem' }}>
          <strong>
            {selectedAccount.code} — {selectedAccount.label}
          </strong>{' '}
          ({selectedAccount.isPostable ? 'compte de mouvement' : 'compte de regroupement'},{' '}
          {selectedAccount.isActive ? 'actif' : 'inactif'})
          <div>
            <button onClick={() => toggleAccount(selectedAccount.id, selectedAccount.isActive)}>
              {selectedAccount.isActive ? 'Désactiver' : 'Réactiver'}
            </button>{' '}
            <button onClick={() => setSelectedAccountId(null)}>Choisir comme parent pour le nouveau compte</button>
          </div>
        </div>
      )}

      <h2>Créer un compte {selectedAccountId ? '(sous-compte du compte sélectionné)' : '(racine)'}</h2>
      <form onSubmit={handleCreate}>
        <div>
          <label htmlFor="newCode">Code</label>
          <input id="newCode" value={newCode} onChange={(e) => setNewCode(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="newLabel">Libellé</label>
          <input id="newLabel" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="newClassId">Classe</label>
          <select id="newClassId" value={newClassId} onChange={(e) => setNewClassId(e.target.value)} required>
            <option value="">— choisir —</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>
            <input type="checkbox" checked={newIsPostable} onChange={(e) => setNewIsPostable(e.target.checked)} /> Compte de mouvement
            (décocher pour un compte de regroupement)
          </label>
        </div>
        <button type="submit" disabled={isCreating}>
          {isCreating ? 'Création…' : 'Créer le compte'}
        </button>
      </form>

      <h2>Importer le plan comptable (CSV)</h2>
      <p style={{ fontSize: '0.9em' }}>
        Format attendu : <code>code;label;parentCode;class;allowsPosting</code>
      </p>
      <input type="file" accept=".csv,text/csv" onChange={handleFileSelect} />
      {csvFileName && (
        <div>
          <p>
            Fichier sélectionné : <strong>{csvFileName}</strong> — {csvContent?.split(/\r?\n/).filter((l) => l.trim()).length ?? 0} ligne(s)
          </p>
          <pre style={{ background: '#f5f5f5', padding: '0.5rem', maxHeight: 200, overflow: 'auto' }}>{csvContent}</pre>
          <button onClick={handleImportConfirm} disabled={isImporting}>
            {isImporting ? 'Import…' : 'Confirmer l\'import'}
          </button>
        </div>
      )}
      {importResult && <p style={{ color: 'green' }}>{importResult.importedCount} compte(s) importé(s) avec succès.</p>}
      {importErrors && (
        <div style={{ color: 'red' }}>
          <p>{importErrors.length} erreur(s) — aucun compte n&apos;a été importé :</p>
          <ul>
            {importErrors.map((e, i) => (
              <li key={i}>
                Ligne {e.line} {e.code ? `(${e.code})` : ''} : {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p>
        <a href="/settings/accounting">Retour aux paramètres comptables</a>
      </p>
    </main>
  );
}

function flattenAccounts(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenAccounts(n.children)]);
}
