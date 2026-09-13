import type { Category, MenuItem, CartSettings } from '../types';
import { DEFAULT_SETTINGS } from '../data/defaultData';
import { normalizeCategory, normalizeItem, normalizeSettings } from './normalize';
export interface MenuData { categories: Category[]; items: MenuItem[]; settings: CartSettings }
export interface MenuCache { get(): MenuData; set(value: MenuData): void }
export function createMenuCache(project: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): MenuCache {
  const key = 'crepe_menu_v2:' + project;
  let value: MenuData = { categories: [], items: [], settings: { ...DEFAULT_SETTINGS } };
  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null');
    if (saved && Array.isArray(saved.categories) && Array.isArray(saved.items) && saved.settings) {
      value = { categories: saved.categories.map(normalizeCategory), items: saved.items.map(normalizeItem),
        settings: normalizeSettings(saved.settings) };
    }
  } catch { /* Blocked, corrupt or full storage must not break the menu. */ }
  return { get: () => value, set: (next) => {
    value = next;
    try { storage?.setItem(key, JSON.stringify(next)); } catch { /* Memory cache still works. */ }
  } };
}
