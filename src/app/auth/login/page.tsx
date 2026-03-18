import LoginForm from './LoginForm';
import { normalizeInternalRedirectPath } from '@/lib/redirect';

interface LoginPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const redirectParam = resolvedSearchParams.redirect;
  const redirectValue = Array.isArray(redirectParam)
    ? redirectParam[0]
    : redirectParam;

  return (
    <LoginForm
      redirectPath={normalizeInternalRedirectPath(redirectValue, '/cic')}
    />
  );
}
