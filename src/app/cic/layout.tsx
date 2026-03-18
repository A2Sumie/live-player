import { ReactNode } from 'react';
import { getCurrentUser } from '@/lib/auth';
import CICNav from '@/components/cic/CICNav';

export default async function CICLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.12),_transparent_40%),linear-gradient(180deg,_#020617,_#0f172a_58%,_#111827)] text-slate-100">
      <CICNav
        fallbackUsername={user?.username ?? null}
        fallbackRole={user?.role ?? null}
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
