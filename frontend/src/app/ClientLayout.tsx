'use client';

import { useEffect, useState } from 'react';
import NextTopLoader from 'nextjs-toploader';
import { Providers } from './providers';
import { theme } from '@/config/theme';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Providers>
      <NextTopLoader color={theme.colors.primary.DEFAULT} showSpinner={false} />
      {children}
    </Providers>
  );
}
