import type { Category, MenuItem, CartSettings } from '../types';
function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('أدخل ' + label);
  return value.trim();
}
export function finiteNumber(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0))
    throw new Error(label + (positive ? ' يجب أن يكون رقمًا موجبًا.' : ' يجب أن يكون رقمًا صالحًا لا يقل عن صفر.'));
  return value;
}
export function imageUrl(value?: string): string {
  if (!value) return '';
  if (/^data:image\/(jpeg|png|webp|gif);base64,/i.test(value)) return value;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('رابط الصورة غير صالح.');
  return url.toString();
}
export function categoryPayload(value: Partial<Category>) {
  return { name: required(value.name, 'اسم التصنيف'), icon: value.icon || '',
    sort_order: finiteNumber(value.sort_order ?? 0, 'ترتيب التصنيف') };
}
export function itemPayload(value: Partial<MenuItem>) {
  return { category_id: required(value.category_id, 'التصنيف'), name: required(value.name, 'اسم الصنف'),
    description: value.description || '', price: finiteNumber(value.price, 'السعر'),
    image_url: imageUrl(value.image_url), is_available: value.is_available !== false, badge: value.badge || '' };
}
export function settingsPayload(value: CartSettings) {
  if (!['USD', 'LBP'].includes(value.base_currency || 'USD')) throw new Error('عملة أساسية غير صالحة.');
  const phone = (value.whatsapp_number || '').trim();
  if (value.enable_whatsapp_order && !/^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s()-]/g, '')))
    throw new Error('أدخل رقم واتساب دوليًا صالحًا.');
  return { cart_name: required(value.cart_name, 'اسم العربة'), cart_tagline: value.cart_tagline || '',
    cart_logo_url: imageUrl(value.cart_logo_url), currency: value.currency || '$', whatsapp_number: phone,
    enable_whatsapp_order: value.enable_whatsapp_order, enable_dual_currency: value.enable_dual_currency ?? true,
    base_currency: value.base_currency || 'USD', exchange_rate: finiteNumber(value.exchange_rate ?? 89500, 'سعر الصرف', true) };
}
