import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const adminId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const sql = await readFile(new URL('../supabase/migrations/202609130001_secure_menu.sql', import.meta.url), 'utf8');
before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id text PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated;
    GRANT ALL ON storage.objects TO anon, authenticated;
  `);
  await db.exec(sql);
  await db.exec(`INSERT INTO auth.users VALUES ('${adminId}'), ('${otherId}');
    INSERT INTO public.menu_admins VALUES ('${adminId}');
    INSERT INTO categories(id,name) VALUES ('c','Sweet');
    INSERT INTO menu_items(id,category_id,name,price) VALUES ('i','c','Crepe',5);`);
});
after(async () => { await db.close(); });
async function asRole<T>(role: 'anon' | 'authenticated', user: string, action: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE ' + role);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
    return await action();
  } finally { await db.exec('ROLLBACK'); }
}
test('anonymous visitors can read but cannot insert, update or delete', async () => {
  for (const table of ['categories', 'menu_items', 'cart_settings']) {
    await asRole('anon', '', async () => { assert.ok((await db.query('SELECT * FROM ' + table)).rows.length); });
    await assert.rejects(asRole('anon', '', () => db.exec('DELETE FROM ' + table)));
    await assert.rejects(asRole('anon', '', () => db.exec('UPDATE ' + table + " SET id = 'changed'")));
  }
  await assert.rejects(asRole('anon', '', () => db.exec("INSERT INTO categories(id,name) VALUES ('bad','Bad')")));
});
test('ordinary authenticated users cannot edit or promote themselves', async () => {
  await asRole('authenticated', otherId, async () => {
    assert.equal((await db.query('SELECT * FROM menu_admins')).rows.length, 0);
    assert.equal((await db.query("UPDATE menu_items SET price=1 RETURNING id")).rows.length, 0);
    assert.equal((await db.query("DELETE FROM menu_items RETURNING id")).rows.length, 0);
  });
  await assert.rejects(asRole('authenticated', otherId, () => db.exec("INSERT INTO categories(id,name) VALUES ('bad','Bad')")));
  await assert.rejects(asRole('authenticated', otherId, () => db.query('INSERT INTO menu_admins VALUES ($1)', [otherId])));
});
test('admin edits advance versions, stale edits fail and category deletion cascades', async () => {
  await asRole('authenticated', adminId, async () => {
    const old = (await db.query<{ updated_at: string }>("SELECT updated_at::text FROM menu_items WHERE id='i'")).rows[0].updated_at;
    const saved = await db.query<{ updated_at: string }>("UPDATE menu_items SET price=7 WHERE id='i' AND updated_at=$1 RETURNING updated_at::text", [old]);
    assert.equal(saved.rows.length, 1); assert.notEqual(saved.rows[0].updated_at, old);
    assert.equal((await db.query("UPDATE menu_items SET price=8 WHERE id='i' AND updated_at=$1 RETURNING id", [old])).rows.length, 0);
    await db.exec("DELETE FROM categories WHERE id='c'");
    assert.equal((await db.query('SELECT * FROM menu_items')).rows.length, 0);
  });
});
test('database rejects invalid prices, exchange rates and currency relabeling', async () => {
  for (const statement of ["UPDATE menu_items SET price=-1", "UPDATE menu_items SET price='NaN'", "UPDATE cart_settings SET exchange_rate=0", "UPDATE cart_settings SET exchange_rate=NULL", "UPDATE cart_settings SET base_currency='LBP'"])
    await assert.rejects(asRole('authenticated', adminId, () => db.exec(statement)));
});
test('only administrators can upload menu images', async () => {
  const insert = () => db.exec("INSERT INTO storage.objects(id,bucket_id,name) VALUES ('img','crepe-menu-images','img.jpg')");
  await assert.rejects(asRole('anon', '', insert));
  await assert.rejects(asRole('authenticated', otherId, insert));
  await asRole('authenticated', adminId, insert);
});
test('migration can be repeated and removes legacy permissive policies and PINs', async () => {
  await db.exec("CREATE POLICY legacy_open ON menu_items FOR ALL USING (true) WITH CHECK (true); ALTER TABLE cart_settings ADD COLUMN admin_pin text");
  await db.exec(sql);
  assert.equal((await db.query("SELECT * FROM pg_policies WHERE policyname='legacy_open'")).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM information_schema.columns WHERE table_name='cart_settings' AND column_name='admin_pin'")).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM menu_items')).rows.length, 1);
});
