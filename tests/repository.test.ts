import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMenuRepository } from '../src/lib/repository';
import { createMenuCache } from '../src/lib/cache';
import { DEFAULT_SETTINGS } from '../src/data/defaultData';

function fixture() {
  const cache = createMenuCache('test');
  cache.set({ categories: [{ id: 'c', name: 'Sweet', sort_order: 1, updated_at: 'v1' }],
    items: [{ id: 'i', category_id: 'c', name: 'Crepe', description: '', price: 5, is_available: true, updated_at: 'v1' }],
    settings: { ...DEFAULT_SETTINGS, updated_at: 'v1' } });
  let admin = true, fail = false, stale = false, tick = 1;
  let pauseReads: Promise<void> | undefined;
  const calls: { table: string; action: string; payload: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  class Query {
    action = 'read'; payload: Record<string, unknown> = {}; filters: Record<string, unknown> = {};
    one = false;
    constructor(readonly table: string) {}
    select() { return this; } order() { return this; } range() { return this; } returns() { return this; }
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    update(payload: Record<string, unknown>) { this.action = 'update'; this.payload = payload; return this; }
    insert(payload: Record<string, unknown>) { this.action = 'insert'; this.payload = payload; return this; }
    delete() { this.action = 'delete'; return this; }
    maybeSingle() { this.one = true; return this; } single() { this.one = true; return this; }
    async execute() {
      if (this.table === 'menu_admins') return { data: admin ? { user_id: 'admin' } : null, error: null };
      const rows = this.table === 'categories' ? cache.get().categories : this.table === 'menu_items' ? cache.get().items : [cache.get().settings];
      if (this.action === 'read') {
        const snapshot = structuredClone(rows);
        await pauseReads;
        return { data: this.one ? snapshot[0] : snapshot, error: null };
      }
      calls.push({ table: this.table, action: this.action, payload: this.payload, filters: this.filters });
      if (fail) return { data: null, error: new Error('server rejected write') };
      if (stale) return { data: null, error: null };
      const current = rows.find(row => !('id' in row) || row.id === this.filters.id) || {};
      return { data: { ...current, ...this.payload, id: this.payload.id || this.filters.id, updated_at: 'v' + (++tick) }, error: null };
    }
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return this.execute().then(resolve, reject); }
  }
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }) },
    from: (table: string) => new Query(table) } as unknown as SupabaseClient;
  return { cache, calls, repo: createMenuRepository(client, cache),
    setAdmin: (value: boolean) => { admin = value; }, setFail: () => { fail = true; },
    setStale: () => { stale = true; }, pauseReads: (value: Promise<void>) => { pauseReads = value; } };
}
test('non-admin cannot mutate the backend or cache', async () => {
  const f = fixture(); f.setAdmin(false);
  await assert.rejects(f.repo.updatePrice('i', 7), /غير مخوّل/);
  assert.equal(f.calls.length, 0); assert.equal(f.cache.get().items[0].price, 5);
});
test('server failure preserves the confirmed value', async () => {
  const f = fixture(); f.setFail();
  await assert.rejects(f.repo.updatePrice('i', 7), /server rejected/);
  assert.equal(f.cache.get().items[0].price, 5);
});
test('stale form versions are sent to the server and cannot overwrite data', async () => {
  const f = fixture(); f.setStale();
  await assert.rejects(f.repo.saveItem({ ...f.cache.get().items[0], price: 9, updated_at: 'old' }), /تغيرت/);
  assert.equal(f.calls[0].filters.updated_at, 'old');
  assert.equal(f.cache.get().items[0].price, 5);
});
test('new records use independent UUIDs and explicit inserts', async () => {
  const f = fixture();
  await f.repo.saveCategory({ name: 'First' }); await f.repo.saveCategory({ name: 'Second' });
  assert.equal(f.calls[0].action, 'insert');
  assert.match(String(f.calls[0].payload.id), /^[0-9a-f-]{36}$/);
  assert.notEqual(f.calls[0].payload.id, f.calls[1].payload.id);
});
test('inline price edits retain the version from when editing started', async () => {
  const f = fixture(); f.setStale();
  await assert.rejects(f.repo.updatePrice('i', 9, 'draft-version'), /تغيرت/);
  assert.equal(f.calls[0].filters.updated_at, 'draft-version');
});
test('queued updates use the version returned by the preceding write', async () => {
  const f = fixture();
  await Promise.all([f.repo.updatePrice('i', 7), f.repo.toggleAvailability('i', false)]);
  assert.deepEqual(f.calls.map(call => call.filters.updated_at), ['v1', 'v2']);
  assert.equal(f.cache.get().items[0].price, 7);
  assert.equal(f.cache.get().items[0].is_available, false);
});
test('a slow pre-edit read cannot overwrite a confirmed edit', async () => {
  const f = fixture(); let release!: () => void;
  f.pauseReads(new Promise<void>(resolve => { release = resolve; }));
  const read = f.repo.fetchData();
  await f.repo.updatePrice('i', 7);
  release(); await read;
  assert.equal(f.cache.get().items[0].price, 7);
});
test('category deletion is one backend operation with atomic cascade', async () => {
  const f = fixture(); await f.repo.deleteCategory('c');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].table, 'categories');
  assert.equal(f.cache.get().items.length, 0); assert.equal(f.cache.get().categories.length, 0);
});
