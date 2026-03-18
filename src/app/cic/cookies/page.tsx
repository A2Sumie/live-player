import CookiesPanel from '@/components/cic/CookiesPanel';
import { requireCICAccess } from '@/lib/cic-auth';

export default async function CICCookiesPage() {
  await requireCICAccess('/cic/cookies');
  return <CookiesPanel />;
}
