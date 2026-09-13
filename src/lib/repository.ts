import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category, MenuItem, CartSettings } from '../types';
import type { MenuCache, MenuData } from './cache';
import { categoryPayload, itemPayload, settingsPayload, finiteNumber } from './validation';
import { normalizeCategory, normalizeItem, normalizeSettings } from './normalize';
export const CATEGORY_COLUMNS = 'id,name,icon,sort_order,created_at,updated_at';
export const ITEM_COLUMNS = 'id,category_id,name,description,price,image_url,is_available,badge,created_at,updated_at';
export const SETTINGS_COLUMNS = 'cart_name,cart_tagline,cart_logo_url,currency,whatsapp_number,enable_whatsapp_order,enable_dual_currency,base_currency,exchange_rate,updated_at';
const conflict = () => new Error('تغيرت هذه البيانات على جهاز آخر أو حُذفت. حدّث القائمة وأعد فتح النموذج قبل الحفظ.');
export async function requireAdmin(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('سجل الدخول بحساب مدير أولًا.');
  const membership = await client.from('menu_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (membership.error || !membership.data) throw new Error('هذا الحساب غير مخوّل لإدارة القائمة.');
  return data.user;
}
export function createMenuRepository(client: SupabaseClient, cache: MenuCache) {
  let revision = 0;
  let pendingRead: Promise<MenuData> | undefined;
  let writes = Promise.resolve<unknown>(undefined);
  async function pages(table: string, columns: string) {
    const rows: Record<string, unknown>[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await client.from(table).select(columns).order('id').range(start, start + 499).returns<Record<string, unknown>[]>();
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 500) return rows;
    }
  }
  function fetchData(): Promise<MenuData> {
    if (pendingRead) return pendingRead;
    const readRevision = revision;
    pendingRead = (async () => {
      const [categories, items, settings] = await Promise.all([
        pages('categories', CATEGORY_COLUMNS), pages('menu_items', ITEM_COLUMNS),
        client.from('cart_settings').select(SETTINGS_COLUMNS).eq('id', 'main_settings').maybeSingle(),
      ]);
      if (settings.error) throw settings.error;
      if (!settings.data) throw new Error('إعدادات القائمة مفقودة. طبّق ملف إعداد قاعدة البيانات.');
      if (readRevision === revision) cache.set({
        categories: categories.map(normalizeCategory).sort((a, b) => a.sort_order - b.sort_order),
        items: items.map(normalizeItem), settings: normalizeSettings(settings.data),
      });
      return cache.get();
    })().finally(() => { pendingRead = undefined; });
    return pendingRead;
  }
  function write<T>(action: () => Promise<T>): Promise<T> {
    const result = writes.then(async () => {
      await requireAdmin(client);
      revision++;
      try { return await action(); } finally { revision++; }
    });
    writes = result.catch(() => undefined);
    return result;
  }
  async function updateRow(table: string, id: string, version: string | undefined, payload: object, columns: string) {
    if (!version) throw conflict();
    const { data, error } = await client.from(table).update(payload).eq('id', id).eq('updated_at', version).select(columns).returns<Record<string, unknown>[]>().maybeSingle();
    if (error) throw error;
    if (!data) throw conflict();
    return data;
  }
  async function deleteRow(table: string, id: string, version?: string) {
    if (!version) throw conflict();
    const { data, error } = await client.from(table).delete().eq('id', id).eq('updated_at', version).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw conflict();
  }
  const saveCategory = (value: Partial<Category>) => write(async () => {
    const payload = categoryPayload(value);
    const current = cache.get().categories.find(row => row.id === value.id);
    let row;
    if (value.id) row = await updateRow('categories', value.id, value.updated_at ?? current?.updated_at, payload, CATEGORY_COLUMNS);
    else {
      const result = await client.from('categories').insert({ id: crypto.randomUUID(), ...payload }).select(CATEGORY_COLUMNS).single();
      if (result.error) throw result.error;
      row = result.data;
    }
    const saved = normalizeCategory(row);
    cache.set({ ...cache.get(), categories: [...cache.get().categories.filter(row => row.id !== saved.id), saved].sort((a, b) => a.sort_order - b.sort_order) });
    return saved;
  });
  const saveItem = (value: Partial<MenuItem>) => write(async () => {
    const payload = itemPayload(value);
    const current = cache.get().items.find(row => row.id === value.id);
    let row;
    if (value.id) row = await updateRow('menu_items', value.id, value.updated_at ?? current?.updated_at, payload, ITEM_COLUMNS);
    else {
      const result = await client.from('menu_items').insert({ id: crypto.randomUUID(), ...payload }).select(ITEM_COLUMNS).single();
      if (result.error) throw result.error;
      row = result.data;
    }
    const saved = normalizeItem(row);
    cache.set({ ...cache.get(), items: [...cache.get().items.filter(row => row.id !== saved.id), saved] });
    return saved;
  });
  const patchItem = (id: string, payload: object, expectedVersion?: string) => write(async () => {
    const current = cache.get().items.find(row => row.id === id);
    const saved = normalizeItem(await updateRow('menu_items', id, expectedVersion ?? current?.updated_at, payload, ITEM_COLUMNS));
    cache.set({ ...cache.get(), items: cache.get().items.map(row => row.id === id ? saved : row) });
  });
  return {
    fetchData, saveCategory, saveItem,
    deleteCategory: (id: string) => write(async () => {
      await deleteRow('categories', id, cache.get().categories.find(row => row.id === id)?.updated_at);
      cache.set({ ...cache.get(), categories: cache.get().categories.filter(row => row.id !== id), items: cache.get().items.filter(row => row.category_id !== id) });
    }),
    deleteItem: (id: string) => write(async () => {
      await deleteRow('menu_items', id, cache.get().items.find(row => row.id === id)?.updated_at);
      cache.set({ ...cache.get(), items: cache.get().items.filter(row => row.id !== id) });
    }),
    updatePrice: (id: string, price: number, expectedVersion?: string) => patchItem(id, { price: finiteNumber(price, 'السعر') }, expectedVersion),
    toggleAvailability: (id: string, available: boolean) => patchItem(id, { is_available: available }),
    saveSettings: (value: CartSettings) => write(async () => {
      const payload = settingsPayload(value);
      if (cache.get().items.length && payload.base_currency !== (cache.get().settings.base_currency || 'USD'))
        throw new Error('تغيير العملة الأساسية يحتاج تحويل جميع الأسعار أولًا. يمكن تعديل سعر الصرف فقط حاليًا.');
      const row = await updateRow('cart_settings', 'main_settings', value.updated_at ?? cache.get().settings.updated_at, payload, SETTINGS_COLUMNS);
      const saved = normalizeSettings(row);
      cache.set({ ...cache.get(), settings: saved });
      return saved;
    }),
  };
}
