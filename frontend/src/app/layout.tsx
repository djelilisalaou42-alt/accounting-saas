import { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth-context';
import { CompanyProvider } from '../lib/company-context';

export const metadata = {
  title: 'Accounting SaaS',
  description: 'Progiciel de gestion comptable SYSCOHADA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AuthProvider>
          <CompanyProvider>{children}</CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
