import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Category, MenuItem, CartSettings } from './types';
import { fetchMenuData, getLocalCategories, getLocalItems, getLocalSettings,
  saveCategory, deleteCategory, saveMenuItem, updateItemPrice, toggleItemAvailability,
  deleteMenuItem, saveCartSettings, setupRealtimeSubscription, isSupabaseConnected } from './lib/supabase';
import { initialView } from './lib/config';
import { CustomerMenu } from './components/CustomerMenu';
import { AdminAuth } from './components/AdminAuth';
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then(module => ({ default: module.AdminDashboard })));
const SupabaseModal = lazy(() => import('./components/SupabaseModal').then(module => ({ default: module.SupabaseModal })));
export default function App() {
  const [viewMode, setViewMode] = useState<'admin' | 'customer' | 'preview'>(() => initialView(location.search, location.hash));
  const [categories, setCategories] = useState(getLocalCategories);
  const [items, setItems] = useState(getLocalItems);
  const [settings, setSettings] = useState(getLocalSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);
  const copyCache = useCallback(() => { setCategories(getLocalCategories()); setItems(getLocalItems()); setSettings(getLocalSettings()); }, []);
  const loadData = useCallback(async () => {
    try { await fetchMenuData(); copyCache(); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'تعذر تحديث القائمة.'); }
    finally { setLoading(false); }
  }, [copyCache]);
  useEffect(() => {
    const route = () => { setViewMode(initialView(location.search, location.hash)); setIsSupabaseModalOpen(false); };
    const refresh = () => { if (navigator.onLine && document.visibilityState === 'visible') void loadData(); };
    void loadData();
    const unsubscribe = setupRealtimeSubscription(refresh);
    const timer = setInterval(refresh, 60000);
    window.addEventListener('hashchange', route);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => { unsubscribe(); clearInterval(timer); window.removeEventListener('hashchange', route); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
  }, [loadData]);
  async function edit(action: () => Promise<unknown>): Promise<void> {
    try { await action(); copyCache(); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'لم يتم تأكيد الحفظ.'); throw error; }
  }
  return <div dir="rtl" className="min-h-screen bg-[#FAF9F6] text-[#2D2D2D]">
    {loading && <p role="status" className="p-3 text-center">جارٍ تحميل القائمة…</p>}
    {error && <div role="alert" className="fixed top-0 inset-x-0 z-[100] bg-red-50 text-red-800 p-3 text-sm shadow">{error} <button className="underline" onClick={() => void loadData()}>إعادة المحاولة</button></div>}
    {viewMode === 'customer' ? <CustomerMenu categories={categories} items={items} settings={settings} /> :
      <AdminAuth><Suspense fallback={<p className="p-4">جارٍ تحميل الإدارة…</p>}>
        {viewMode === 'preview' ? <CustomerMenu categories={categories} items={items} settings={settings} onBackToAdmin={() => setViewMode('admin')} /> :
          <AdminDashboard categories={categories} items={items} settings={settings} isSupabaseConnected={isSupabaseConnected()}
            onGoToMenu={() => setViewMode('preview')} onReloadData={loadData}
            onSaveCategory={(value: Partial<Category>) => edit(() => saveCategory(value))}
            onDeleteCategory={id => edit(() => deleteCategory(id))}
            onSaveItem={(value: Partial<MenuItem>) => edit(() => saveMenuItem(value))}
            onUpdatePrice={(id, price, version) => edit(() => updateItemPrice(id, price, version))}
            onToggleAvailability={(id, value) => edit(() => toggleItemAvailability(id, value))}
            onDeleteItem={id => edit(() => deleteMenuItem(id))}
            onSaveSettings={(value: CartSettings) => edit(() => saveCartSettings(value))}
            onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)} />}
        <SupabaseModal isOpen={isSupabaseModalOpen} onClose={() => setIsSupabaseModalOpen(false)} onSaved={loadData} />
      </Suspense></AdminAuth>}
  </div>;
}
