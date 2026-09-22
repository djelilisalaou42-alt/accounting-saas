'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CompanySelector } from './CompanySelector';
import { useAuth } from '../../lib/auth-context';

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Comptabilité',
    items: [
      { href: '/accounting/dashboard', label: 'Tableau de bord' },
      { href: '/accounting/journals', label: 'Journaux' },
      { href: '/accounting/entries', label: 'Écritures' },
      { href: '/accounting/general-ledger', label: 'Grand livre' },
      { href: '/accounting/trial-balance', label: 'Balance générale' },
      { href: '/accounting/lettering', label: 'Lettrage' },
    ],
  },
  {
    title: 'Ventes / Achats',
    items: [
      { href: '/customers', label: 'Clients' },
      { href: '/suppliers', label: 'Fournisseurs' },
      { href: '/accounting/quotes', label: 'Devis' },
      { href: '/accounting/invoices', label: 'Factures' },
      { href: '/accounting/payments', label: 'Paiements' },
    ],
  },
  {
    title: 'Trésorerie',
    items: [
      { href: '/treasury/cash', label: 'Caisses' },
      { href: '/treasury/banks', label: 'Comptes bancaires' },
      { href: '/treasury/reconciliation', label: 'Rapprochements' },
    ],
  },
  {
    title: 'Fiscalité & immobilisations',
    items: [
      { href: '/accounting/taxes', label: 'Taxes' },
      { href: '/accounting/taxes/declarations', label: 'Déclarations fiscales' },
      { href: '/accounting/assets', label: 'Immobilisations' },
      { href: '/accounting/budgets', label: 'Budgets' },
    ],
  },
  {
    title: 'Rapports',
    items: [{ href: '/accounting/reports', label: 'Rapports' }],
  },
  {
    title: 'Paramètres',
    items: [
      { href: '/settings/accounting', label: 'Paramètres comptables' },
      { href: '/companies', label: 'Mes entreprises' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <Link href="/" className="text-lg font-bold text-gray-900 no-underline hover:no-underline">
          Accounting SaaS
        </Link>
        <div className="mt-3">
          <CompanySelector />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-5">
            <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {group.title}
            </p>
            <ul className="m-0 list-none space-y-0.5 p-0">
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-md px-2 py-1.5 text-sm no-underline hover:no-underline ${
                        isActive
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <p className="mb-0.5 truncate text-sm font-medium text-gray-900">
          {user?.firstName} {user?.lastName}
        </p>
        <p className="mb-2 truncate text-xs text-gray-500">{user?.email}</p>
        <button
          onClick={() => logout()}
          className="w-full border-gray-300 text-sm"
        >
          Se déconnecter
        </button>
      </div>
    </aside>
  );
}
