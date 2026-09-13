import React, { useState } from 'react';
import { SUPABASE_SQL_SCRIPT } from '../lib/setupSql';
export function SupabaseModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void; onSaved?: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  if (!isOpen) return null;
  async function copySql() {
    try { await navigator.clipboard.writeText(SUPABASE_SQL_SCRIPT); setMessage('تم نسخ SQL.'); }
    catch { setMessage('تعذر النسخ. انسخ النص يدويًا من الحقل أدناه.'); }
  }
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir="rtl">
    <section role="dialog" aria-modal="true" aria-labelledby="setup-title" className="bg-white rounded-xl p-5 max-w-lg w-full space-y-3">
      <h2 id="setup-title" className="font-bold">إعداد Supabase</h2>
      <p className="text-sm">اضبط عنوان المشروع والمفتاح العام في متغيرات بيئة البناء. خذ نسخة احتياطية، ثم طبّق SQL وأنشئ حساب المدير حسب README. لا يكفي نسخ الملف لتفعيل الحماية.</p>
      <textarea readOnly value={SUPABASE_SQL_SCRIPT} dir="ltr" aria-label="SQL إعداد قاعدة البيانات" className="border p-2 text-xs w-full h-48" />
      <p role="status">{message}</p>
      <button onClick={() => void copySql()} className="bg-yellow-400 rounded p-2 ml-2">نسخ SQL</button>
      <button onClick={onClose} className="border rounded p-2">إغلاق</button>
    </section>
  </div>;
}
