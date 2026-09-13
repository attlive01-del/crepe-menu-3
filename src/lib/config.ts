export interface PublicConfig { url: string; anonKey: string; publicMenuUrl?: string }
const localHost = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function readPublicConfig(env: Record<string, unknown>): PublicConfig {
  const rawUrl = String(env.VITE_SUPABASE_URL || '').trim();
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!rawUrl || !anonKey) throw new Error('يلزم ضبط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY ثم إعادة بناء التطبيق.');
  const url = new URL(rawUrl);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost(url.hostname))) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('عنوان Supabase غير صالح. استخدم عنوان المشروع الآمن فقط.');
  let publicKey = anonKey.startsWith('sb_publishable_');
  try {
    const part = anonKey.split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    publicKey ||= payload.role === 'anon';
  } catch { /* Publishable keys are not JWTs. */ }
  if (!publicKey || anonKey.startsWith('sb_secret_')) throw new Error('استخدم المفتاح العام anon أو publishable فقط.');
  return { url: url.origin, anonKey, publicMenuUrl: String(env.VITE_PUBLIC_MENU_URL || '').trim() || undefined };
}
export function initialView(search: string, hash: string): 'admin' | 'customer' {
  const params = new URLSearchParams(search);
  if (['qr', 'menu'].includes(params.get('mode') || '') || params.get('qr') === '1') return 'customer';
  return hash === '#/admin' ? 'admin' : 'customer';
}
export function publicMenuUrl(currentUrl: string, configured?: string): string {
  const url = new URL(configured || currentUrl);
  if (localHost(url.hostname)) return '';
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('رابط القائمة يجب أن يبدأ بـ https://');
  url.search = '?mode=qr';
  url.hash = '';
  return url.toString();
}
