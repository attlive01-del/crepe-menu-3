import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPublicConfig, initialView, publicMenuUrl } from '../src/lib/config';
import { createMenuCache } from '../src/lib/cache';
import { normalizeItem, normalizeSettings } from '../src/lib/normalize';
import { itemPayload, settingsPayload } from '../src/lib/validation';
import { DEFAULT_SETTINGS } from '../src/data/defaultData';
import { formatDualPrice } from '../src/lib/currency';
const jwt = (role: string) => 'header.' + btoa(JSON.stringify({ role })) + '.signature';
test('configuration accepts public keys and rejects secrets and unsafe targets', () => {
  const env = { VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') };
  assert.equal(readPublicConfig(env).url, env.VITE_SUPABASE_URL);
  for (const key of [jwt('service_role'), 'sb_secret_test', 'invalid']) assert.throws(() => readPublicConfig({ ...env, VITE_SUPABASE_ANON_KEY: key }));
  for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com/path', 'https://example.com?key=value']) assert.throws(() => readPublicConfig({ ...env, VITE_SUPABASE_URL: url }));
  assert.throws(() => readPublicConfig({}));
});
test('public routing is the default and QR never includes admin or localhost', () => {
  assert.equal(initialView('', ''), 'customer');
  assert.equal(initialView('', '#/admin'), 'admin');
  assert.equal(initialView('?mode=qr', '#/admin'), 'customer');
  assert.equal(publicMenuUrl('https://menu.example/app?key=value#/admin'), 'https://menu.example/app?mode=qr');
  assert.equal(publicMenuUrl('https://localhost/'), '');
  assert.equal(publicMenuUrl('https://localhost/', 'https://menu.example/'), 'https://menu.example/?mode=qr');
  assert.throws(() => publicMenuUrl('http://unsafe.example/'));
});
test('nullable legacy fields do not crash search and do not expose old PINs', () => {
  const item = normalizeItem({ id: 'legacy', name: 'Crepe', description: null, price: '5.50' });
  assert.equal(item.description.toLowerCase(), '');
  assert.equal(item.price, 5.5);
  const settings = normalizeSettings({ whatsapp_number: null, admin_pin: 'obsolete', supabase_anon_key: 'ignored' });
  assert.equal(settings.whatsapp_number, '');
  assert.equal('admin_pin' in settings, false);
  assert.equal('supabase_anon_key' in settings, false);
});
test('cache tolerates corruption and quota failures while isolating projects', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || '{broken', setItem: () => { throw new Error('QuotaExceeded'); } };
  const cache = createMenuCache('project-a', storage);
  const data = { ...cache.get(), settings: { ...DEFAULT_SETTINGS, cart_name: 'Saved in memory' } };
  assert.doesNotThrow(() => cache.set(data));
  assert.equal(cache.get().settings.cart_name, 'Saved in memory');
  assert.notEqual(createMenuCache('project-b', storage).get().settings.cart_name, 'Saved in memory');
  values.set('crepe_cart_pending_queue_v1', '[{"old":true}]');
  createMenuCache('project-a', storage);
  assert.equal(values.get('crepe_cart_pending_queue_v1'), '[{"old":true}]');
});
test('writes reject invalid prices, exchange rates and image protocols', () => {
  const item = { name: 'Crepe', category_id: 'sweet', price: 5 };
  for (const price of [-1, NaN, Infinity]) assert.throws(() => itemPayload({ ...item, price }));
  assert.throws(() => itemPayload({ ...item, image_url: 'javascript:alert(1)' }));
  assert.throws(() => settingsPayload({ ...DEFAULT_SETTINGS, exchange_rate: 0 }));
  assert.throws(() => settingsPayload({ ...DEFAULT_SETTINGS, whatsapp_number: 'abc', enable_whatsapp_order: true }));
  const payload = settingsPayload({ ...DEFAULT_SETTINGS, supabase_anon_key: 'ignored' });
  assert.equal('supabase_anon_key' in payload, false);
});
test('dual currency totals retain consistent USD and LBP values', () => {
  const usd = formatDualPrice(10, { ...DEFAULT_SETTINGS, exchange_rate: 90000 });
  const lbp = formatDualPrice(900000, { ...DEFAULT_SETTINGS, base_currency: 'LBP', exchange_rate: 90000 });
  assert.equal(usd.lbpNumeric, 900000);
  assert.equal(lbp.usdNumeric, 10);
});
