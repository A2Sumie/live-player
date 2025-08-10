'use client';

import { ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';

interface WithAuthProps {
  children: ReactNode;
}

export function WithAuth({ children }: WithAuthProps) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}

export { useAuth } from './AuthProvider';