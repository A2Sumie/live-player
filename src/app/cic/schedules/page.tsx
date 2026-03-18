import SchedulesPanel from '@/components/cic/SchedulesPanel';
import { requireCICAccess } from '@/lib/cic-auth';

export default async function CICSchedulesPage() {
  await requireCICAccess('/cic/schedules');
  return <SchedulesPanel />;
}
