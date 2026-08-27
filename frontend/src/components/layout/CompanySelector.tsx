'use client';

import { useState } from 'react';
import { useCompany } from '../../lib/company-context';

export function CompanySelector() {
  const { companies, currentCompanyId, switchCompany, isLoading } = useCompany();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  if (isLoading) return <span>Chargement des entreprises…</span>;
  if (companies.length === 0) return <a href="/companies/new">Créer votre première entreprise</a>;

  const current = companies.find((c) => c.companyId === currentCompanyId) ?? companies[0];

  async function handleSelect(companyId: string) {
    setIsOpen(false);
    if (companyId === currentCompanyId) return;
    setIsSwitching(true);
    try {
      await switchCompany(companyId);
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setIsOpen((v) => !v)} disabled={isSwitching}>
        {current.companyName} ({current.roleName}) ▼
      </button>
      {isOpen && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            border: '1px solid #ccc',
            background: 'white',
            listStyle: 'none',
            margin: 0,
            padding: '0.25rem 0',
            minWidth: 220,
            zIndex: 10,
          }}
        >
          {companies.map((c) => (
            <li key={c.companyId}>
              <button
                onClick={() => handleSelect(c.companyId)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.4rem 0.75rem',
                  fontWeight: c.companyId === currentCompanyId ? 'bold' : 'normal',
                }}
              >
                {c.companyName} — {c.roleName}
              </button>
            </li>
          ))}
          <li style={{ borderTop: '1px solid #eee' }}>
            <a href="/companies/new" style={{ display: 'block', padding: '0.4rem 0.75rem' }}>
              + Nouvelle entreprise
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
