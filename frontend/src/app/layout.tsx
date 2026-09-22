import { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth-context';
import { CompanyProvider } from '../lib/company-context';
import { AppShell } from '../components/layout/AppShell';
import './globals.css';

export const metadata = {
  title: 'Accounting SaaS',
  description: 'Progiciel de gestion comptable SYSCOHADA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AuthProvider>
          <CompanyProvider>
            <AppShell>{children}</AppShell>
          </CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
