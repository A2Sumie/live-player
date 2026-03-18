import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { normalizeInternalRedirectPath } from '@/lib/redirect';

export async function requireCICAccess(redirectPath: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    const target = normalizeInternalRedirectPath(redirectPath, '/cic');
    redirect(`/auth/login?redirect=${encodeURIComponent(target)}`);
  }

  return user;
}
