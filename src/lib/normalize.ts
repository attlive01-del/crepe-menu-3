import type { Category, MenuItem, CartSettings } from '../types';
import { DEFAULT_SETTINGS } from '../data/defaultData';
type Row = Record<string, unknown>;
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const number = (value: unknown, fallback: number) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
export function normalizeCategory(row: Row): Category {
  return { id: text(row.id), name: text(row.name), icon: text(row.icon), sort_order: number(row.sort_order, 0),
    created_at: text(row.created_at) || undefined, updated_at: text(row.updated_at) || undefined };
}
export function normalizeItem(row: Row): MenuItem {
  return { id: text(row.id), category_id: text(row.category_id), name: text(row.name),
    description: text(row.description), price: number(row.price, 0), image_url: text(row.image_url),
    is_available: row.is_available !== false, badge: text(row.badge),
    created_at: text(row.created_at) || undefined, updated_at: text(row.updated_at) || undefined };
}
export function normalizeSettings(row: Row): CartSettings {
  return { cart_name: text(row.cart_name, DEFAULT_SETTINGS.cart_name),
    cart_tagline: text(row.cart_tagline), cart_logo_url: text(row.cart_logo_url),
    currency: text(row.currency, '$'), whatsapp_number: text(row.whatsapp_number),
    enable_whatsapp_order: row.enable_whatsapp_order === true,
    enable_dual_currency: row.enable_dual_currency !== false,
    base_currency: row.base_currency === 'LBP' ? 'LBP' : 'USD',
    exchange_rate: number(row.exchange_rate, 89500),
    updated_at: text(row.updated_at) || undefined };
}
