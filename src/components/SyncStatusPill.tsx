import React, { useEffect, useState } from 'react';
import { getCurrentSyncStatus, subscribeSyncStatus, refreshMenuData } from '../lib/supabase';
export function SyncStatusPill({ onRefreshData }: { onRefreshData?: () => Promise<void> }) {
  const [status, setStatus] = useState(getCurrentSyncStatus);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeSyncStatus(setStatus), []);
  return <div className="relative text-xs">
    <button onClick={() => setOpen(!open)} className="rounded-lg border px-2 py-1">
      {status.syncing ? 'جارٍ الاتصال…' : status.connected ? 'آخر اتصال ناجح' : 'تعذر الاتصال'}
    </button>
    {open && <div className="absolute left-0 top-full z-40 mt-2 bg-white border shadow-lg rounded-xl p-3 w-64 space-y-2">
      <p>الحفظ يحتاج اتصالًا وتأكيدًا من الخادم. عند انقطاع الشبكة تتوفر آخر قائمة محفوظة للقراءة.</p>
      {status.lastSuccess && <p>آخر نجاح: {new Date(status.lastSuccess).toLocaleTimeString('ar')}</p>}
      {status.error && <p className="text-red-700">{status.error}</p>}
      <button disabled={status.syncing} onClick={() => void refreshMenuData().then(() => onRefreshData?.()).catch(() => {})} className="bg-yellow-400 p-2 rounded-lg">تحديث القائمة</button>
    </div>}
  </div>;
}
