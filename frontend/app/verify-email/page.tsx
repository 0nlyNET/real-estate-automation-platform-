'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/api';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = useMemo(
    () => searchParams.get('token')?.trim() || '',
    [searchParams]
  );

  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error' | 'missing'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('missing');
      setMessage('Missing verification token');
      return;
    }

    (async () => {
      try {
        setStatus('verifying');

        const res = await fetch(`${API_BASE_URL}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.message || 'Verification failed');
        }

        setStatus('success');
        setMessage('Email verified. Redirecting to login...');
        setTimeout(() => router.push('/login'), 800);
      } catch (e: any) {
        setStatus('error');
        setMessage(e.message || 'Verification failed');
      }
    })();
  }, [token, router]);

  return (
    <div style={{ padding: 24 }}>
      {status === 'verifying' && <p>Verifying...</p>}
      {status === 'success' && <p>{message}</p>}
      {status === 'missing' && <p>{message}</p>}
      {status === 'error' && <p>{message}</p>}
      {status === 'idle' && <p>Preparing...</p>}
    </div>
  );
}
