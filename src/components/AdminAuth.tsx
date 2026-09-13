import React, { useEffect, useRef, useState } from 'react';
import { supabase, configurationError, legacyPendingCount } from '../lib/supabase';
import { requireAdmin } from '../lib/repository';

export function AdminAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'login' | 'allowed'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  async function verify() {
    const current = ++sequence.current;
    try {
      if (!supabase) throw new Error(configurationError);
      await requireAdmin(supabase);
      if (current === sequence.current) { setState('allowed'); setError(''); }
    } catch (error) {
      if (current === sequence.current) {
        setState('login');
        setError(error instanceof Error ? error.message : 'تعذر التحقق من الحساب.');
      }
    }
  }
  useEffect(() => {
    void verify();
    let timer: ReturnType<typeof setTimeout>;
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { sequence.current++; setState('login'); setPassword(''); }
      else { clearTimeout(timer); timer = setTimeout(() => void verify(), 0); }
    });
    return () => { sequence.current++; clearTimeout(timer); subscription?.data.subscription.unsubscribe(); };
  }, []);
  async function signOut() {
    sequence.current++;
    setState('login');
    setPassword('');
    const result = await supabase?.auth.signOut({ scope: 'local' });
    if (result?.error) setError('تعذر إنهاء الجلسة؛ حاول تسجيل الخروج مجددًا.');
  }
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw new Error('تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور والاتصال.');
      setPassword('');
      await verify();
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تسجيل الدخول.'); }
    finally { setBusy(false); }
  }
  if (state === 'checking') return <p role="status" className="p-8 text-center">جارٍ التحقق من حساب المدير…</p>;
  if (state === 'allowed') return <>
    <div className="bg-slate-900 text-white p-2 text-xs flex justify-between">
      <span>إدارة القائمة</span><button onClick={() => void signOut()} className="underline">تسجيل الخروج</button>
    </div>
    {legacyPendingCount() > 0 && <p role="alert" className="bg-amber-100 p-3 text-sm">توجد تعديلات قديمة معلّقة على هذا الجهاز. احتفظ بنسخة منها قبل مسح بيانات المتصفح؛ راجع دليل المشروع لاستعادتها يدويًا.</p>}
    {children}
  </>;
  return <main dir="rtl" className="max-w-sm mx-auto p-6 mt-12 space-y-4">
    <h1 className="text-xl font-bold">دخول المدير</h1>
    <p className="text-sm">استخدم حساب المدير المسجّل في Supabase.</p>
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    <form onSubmit={signIn} className="space-y-4">
      <label className="block">البريد الإلكتروني<input className="border rounded-lg p-2 w-full" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="block">كلمة المرور<input className="border rounded-lg p-2 w-full" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button disabled={busy || !supabase} className="bg-yellow-400 rounded-lg p-3 w-full disabled:opacity-50">{busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}</button>
    </form>
    <a href="#/" className="block underline">العودة إلى القائمة</a>
    <button onClick={() => void signOut()} className="text-sm underline">تسجيل الخروج</button>
  </main>;
}
