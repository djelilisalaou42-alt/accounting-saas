'use client';

export default function ReportsHubPage() {
  const reports = [
    { href: '/accounting/trial-balance', title: 'Balance générale', desc: "Total débit/crédit et solde par compte, sur une période." },
    { href: '/accounting/general-ledger', title: 'Grand Livre', desc: 'Mouvements détaillés compte par compte, solde progressif.' },
    { href: '/accounting/reports/journal', title: 'Journal comptable', desc: 'Toutes les écritures, filtrables par journal, compte, statut.' },
    { href: '/accounting/reports/income-statement', title: 'Compte de résultat', desc: 'Produits, charges et résultat, avec comparaison de périodes.' },
    { href: '/accounting/reports/balance-sheet', title: 'Bilan', desc: 'Actif, passif et capitaux propres à une date donnée.' },
    { href: '/accounting/reports/budget', title: 'Analyse budgétaire', desc: 'Budget vs réalisé, écarts et taux de consommation.' },
    { href: '/accounting/reports/taxes', title: 'Analyse fiscale', desc: 'TVA collectée/déductible/nette, déclarations et paiements.' },
    { href: '/accounting/reports/treasury', title: 'Analyse de trésorerie', desc: 'Encaissements, décaissements et soldes caisse/banque.' },
  ];

  return (
    <main style={{ maxWidth: 900, margin: '4rem auto' }}>
      <h1>Rapports</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
        {reports.map((r) => (
          <a key={r.href} href={r.href} style={{ display: 'block', border: '1px solid #ddd', borderRadius: 6, padding: '1rem', textDecoration: 'none', color: 'inherit' }}>
            <strong>{r.title}</strong>
            <p style={{ margin: '0.5rem 0 0', color: '#666', fontSize: '0.9rem' }}>{r.desc}</p>
          </a>
        ))}
      </div>
      <p style={{ marginTop: '2rem' }}>
        <a href="/">Retour à l&apos;accueil</a>
      </p>
    </main>
  );
}
