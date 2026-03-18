import OpsPanel from '@/components/cic/OpsPanel';
import { requireCICAccess } from '@/lib/cic-auth';

export default async function CICOpsPage() {
  await requireCICAccess('/cic/ops');
  return <OpsPanel />;
}
