-- Run as the project owner in Supabase SQL Editor after a backup.
-- Public menu reads; only Auth users explicitly in menu_admins can edit.
BEGIN;
CREATE TABLE IF NOT EXISTS public.categories (
  id text PRIMARY KEY, name text NOT NULL, icon text, sort_order int DEFAULT 1,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.menu_items (
  id text PRIMARY KEY, category_id text REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL, description text, price numeric NOT NULL, image_url text,
  is_available boolean DEFAULT true, badge text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cart_settings (
  id text PRIMARY KEY DEFAULT 'main_settings', cart_name text DEFAULT 'عربة كريب الملوك',
  cart_tagline text DEFAULT '', cart_logo_url text, currency text DEFAULT '$',
  whatsapp_number text, enable_whatsapp_order boolean DEFAULT false,
  enable_dual_currency boolean DEFAULT true, base_currency text DEFAULT 'USD',
  exchange_rate numeric DEFAULT 89500, updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.cart_settings DROP COLUMN IF EXISTS admin_pin;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.cart_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE public.cart_settings SET updated_at = now() WHERE updated_at IS NULL;
ALTER TABLE public.cart_settings ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.cart_settings ALTER COLUMN updated_at SET NOT NULL;
INSERT INTO public.cart_settings (id) VALUES ('main_settings') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.menu_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.menu_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_admins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.menu_admins TO authenticated;

-- Permissive policies are OR-ed together: remove legacy policies on these app tables.
DO $$
DECLARE p record; t text;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('categories', 'menu_items', 'cart_settings', 'menu_admins')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename); END LOOP;
  FOR t IN SELECT unnest(ARRAY['categories', 'menu_items', 'cart_settings'])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY menu_read ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.menu_admins WHERE user_id = (SELECT auth.uid())))', t);
    EXECUTE format('CREATE POLICY admin_update ON public.%I FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.menu_admins WHERE user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.menu_admins WHERE user_id = (SELECT auth.uid())))', t);
    EXECUTE format('CREATE POLICY admin_delete ON public.%I FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.menu_admins WHERE user_id = (SELECT auth.uid())))', t);
  END LOOP;
END $$;
CREATE POLICY admin_self_read ON public.menu_admins FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.menu_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['categories', 'menu_items', 'cart_settings'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS menu_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER menu_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.menu_touch_updated_at()', t);
  END LOOP;
END $$;

-- NOT VALID preserves legacy rows for review while checking every new/updated row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.menu_items'::regclass AND conname = 'menu_price_valid') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_price_valid CHECK (price >= 0 AND price < 'Infinity'::numeric) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cart_settings'::regclass AND conname = 'menu_rate_valid') THEN
    ALTER TABLE public.cart_settings ADD CONSTRAINT menu_rate_valid CHECK (exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate < 'Infinity'::numeric) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.cart_settings'::regclass AND conname = 'menu_base_valid') THEN
    ALTER TABLE public.cart_settings ADD CONSTRAINT menu_base_valid CHECK (base_currency IS NOT NULL AND base_currency IN ('USD','LBP')) NOT VALID;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.menu_guard_base_currency() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.base_currency IS DISTINCT FROM OLD.base_currency AND EXISTS (SELECT 1 FROM public.menu_items) THEN
    RAISE EXCEPTION 'Convert all existing prices before changing the base currency';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS menu_base_currency ON public.cart_settings;
CREATE TRIGGER menu_base_currency BEFORE UPDATE ON public.cart_settings
  FOR EACH ROW EXECUTE FUNCTION public.menu_guard_base_currency();
CREATE INDEX IF NOT EXISTS menu_items_category_idx ON public.menu_items(category_id);

-- Only images intended for the public menu belong in this bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('crepe-menu-images', 'crepe-menu-images', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];
DROP POLICY IF EXISTS menu_admin_image_upload ON storage.objects;
CREATE POLICY menu_admin_image_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'crepe-menu-images' AND EXISTS (
  SELECT 1 FROM public.menu_admins WHERE user_id = (SELECT auth.uid())
));

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOR t IN SELECT unnest(ARRAY['categories', 'menu_items', 'cart_settings'])
    LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;
COMMIT;
