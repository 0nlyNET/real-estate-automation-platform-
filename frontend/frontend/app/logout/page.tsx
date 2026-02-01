'use client';

import { useEffect } from 'react';

function clearCookie(name: string) {
  try {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {}
}

export default function LogoutPage() {
  useEffect(() => {
    try {
      localStorage.removeItem('rtai_token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('token');
    } catch {}

    clearCookie('rtai_token');
    clearCookie('accessToken');
    clearCookie('token');

    window.location.assign('/');
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <p>Signing you out...</p>
    </main>
  );
}
