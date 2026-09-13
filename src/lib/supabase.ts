import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Category, MenuItem, CartSettings } from '../types';
import { readPublicConfig, type PublicConfig } from './config';
import { createMenuCache } from './cache';
import { createMenuRepository, requireAdmin } from './repository';

let config: PublicConfig | undefined;
export let configurationError = '';
try { config = readPublicConfig(import.meta.env); }
catch (error) { configurationError = error instanceof Error ? error.message : 'إعدادات الاتصال غير صالحة.'; }
export const hasSupabaseConfig = !!config;
let browserStorage: Storage | undefined;
try { browserStorage = window.localStorage; } catch { /* Private browsing may block storage. */ }
const cache = createMenuCache(config?.url || 'unconfigured', browserStorage);
const sessionMemory = new Map<string, string>();
const authStorage = {
  getItem(key: string) { try { return browserStorage?.getItem(key) ?? sessionMemory.get(key) ?? null; } catch { return sessionMemory.get(key) ?? null; } },
  setItem(key: string, value: string) { sessionMemory.set(key, value); try { browserStorage?.setItem(key, value); } catch { /* Session stays in memory. */ } },
  removeItem(key: string) { sessionMemory.delete(key); try { browserStorage?.removeItem(key); } catch { /* Memory session cleared. */ } },
};
export const supabase: SupabaseClient | null = config ? createClient(config.url, config.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage },
  global: { fetch: async (input, init) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init?.signal?.aborted) abort();
    init?.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15000);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timeout); init?.signal?.removeEventListener('abort', abort); }
  } },
}) : null;
const repository = supabase ? createMenuRepository(supabase, cache) : null;
function requireRepository() {
  if (!repository) throw new Error(configurationError);
  return repository;
}
export const getLocalCategories = () => cache.get().categories;
export const getLocalItems = () => cache.get().items;
export const getLocalSettings = (): CartSettings => ({ ...cache.get().settings, supabase_url: config?.url || '', supabase_anon_key: config?.anonKey || '' });
export const getPublicMenuAddress = () => config?.publicMenuUrl;
export interface SyncStatus { syncing: boolean; connected: boolean; lastSuccess: number | null; error: string }
let status: SyncStatus = { syncing: false, connected: false, lastSuccess: null, error: configurationError };
const listeners = new Set<(status: SyncStatus) => void>();
function report(update: Partial<SyncStatus>) { status = { ...status, ...update }; listeners.forEach(listener => listener(status)); }
export const getCurrentSyncStatus = () => status;
export function subscribeSyncStatus(listener: (status: SyncStatus) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function isSupabaseConnected() { return status.connected; }
let activeOperations = 0;
async function confirmed<T>(action: () => Promise<T>): Promise<T> {
  activeOperations++;
  report({ syncing: true });
  try { const result = await action(); report({ connected: true, lastSuccess: Date.now(), error: '' }); return result; }
  catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || 'فشل الاتصال. لم يتم تأكيد الحفظ.');
    report({ connected: false, error: message }); throw new Error(message);
  } finally { activeOperations--; report({ syncing: activeOperations > 0 }); }
}
export const fetchMenuData = () => confirmed(() => requireRepository().fetchData());
export const saveCategory = (value: Partial<Category>) => confirmed(() => requireRepository().saveCategory(value));
export const deleteCategory = (id: string) => confirmed(() => requireRepository().deleteCategory(id));
export const saveMenuItem = (value: Partial<MenuItem>) => confirmed(() => requireRepository().saveItem(value));
export const deleteMenuItem = (id: string) => confirmed(() => requireRepository().deleteItem(id));
export const updateItemPrice = (id: string, price: number, expectedVersion?: string) => confirmed(() => requireRepository().updatePrice(id, price, expectedVersion));
export const toggleItemAvailability = (id: string, value: boolean) => confirmed(() => requireRepository().toggleAvailability(id, value));
export const saveCartSettings = (value: CartSettings) => confirmed(() => requireRepository().saveSettings(value));
export async function refreshMenuData() {
  await fetchMenuData();
  return { success: true, message: 'تم تحديث القائمة من قاعدة البيانات.' };
}
export async function testSupabaseConnection() {
  try { return await refreshMenuData(); }
  catch (error) { return { success: false, message: error instanceof Error ? error.message : 'تعذر الاتصال.' }; }
}
export function legacyPendingCount() {
  try {
    const queue = JSON.parse(browserStorage?.getItem('crepe_cart_pending_queue_v1') || '[]');
    return Array.isArray(queue) ? queue.length : 0;
  } catch { return 0; }
}
export function setupRealtimeSubscription(onChange: () => void) {
  if (!supabase) return () => {};
  let timer: ReturnType<typeof setTimeout>;
  const changed = () => { clearTimeout(timer); timer = setTimeout(onChange, 300); };
  let channel = supabase.channel('public-menu');
  for (const table of ['categories', 'menu_items', 'cart_settings'])
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, changed);
  channel.subscribe();
  return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
}
export async function uploadMenuImage(dataUrl: string) {
  if (!supabase) throw new Error(configurationError);
  await requireAdmin(supabase);
  if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('تعذر تحويل الصورة إلى JPEG. اختر صورة أخرى.');
  const blob = await (await fetch(dataUrl)).blob();
  if (blob.size > 2 * 1024 * 1024) throw new Error('الصورة كبيرة؛ الحد بعد الضغط 2 ميغابايت.');
  const path = crypto.randomUUID() + '.jpg';
  const bucket = supabase.storage.from('crepe-menu-images');
  const { error } = await bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return bucket.getPublicUrl(path).data.publicUrl;
}
