'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSelector } from 'react-redux';
import type { RootState } from '@/stores/store';
import { useSilentSignIn } from '@/features/sso/useSilentSignIn';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  // Not signed in to Mindspear: a browser signed in to BDREN is signed in and comes back to this page;
  // any other goes to the sign-in page.
  const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/dashboard';
  const checking = useSilentSignIn({ active: !isAuthenticated, next: here, fallback: '/auth/sign-in' });

  useEffect(() => {
    if (!isAuthenticated && !checking) router.replace('/auth/sign-in');
  }, [isAuthenticated, checking, router]);

  if (!isAuthenticated) return null;

  return <>{children}</>;
}
