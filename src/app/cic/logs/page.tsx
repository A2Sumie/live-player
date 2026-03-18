import LogsPanel from '@/components/cic/LogsPanel';
import { requireCICAccess } from '@/lib/cic-auth';

export default async function CICLogsPage() {
  await requireCICAccess('/cic/logs');
  return <LogsPanel />;
}
