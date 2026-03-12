export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}
