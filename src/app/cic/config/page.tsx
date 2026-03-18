import ConfigConsole from '@/components/cic/config/ConfigConsole';
import { requireCICAccess } from '@/lib/cic-auth';

export default async function CICConfigPage() {
  await requireCICAccess('/cic/config');
  return <ConfigConsole />;
}
