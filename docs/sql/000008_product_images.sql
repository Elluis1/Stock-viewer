-- 000008_product_images.sql
-- Imágenes de producto en Supabase Storage (bucket product-images)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_path text;

COMMENT ON COLUMN public.products.image_path IS
  'Path relativo en bucket product-images (ej. companyId/productId/file.webp).';

DROP VIEW IF EXISTS public.product_inventory_snapshot;

CREATE VIEW public.product_inventory_snapshot AS
SELECT
  p.id AS product_id,
  p.company_id,
  p.name,
  p.sku,
  p.unit,
  p.default_cost_unit,
  p.default_sale_price_unit,
  COALESCE((
    SELECT sum(sm.quantity)
    FROM public.stock_movements sm
    WHERE sm.product_id = p.id
  ), 0::numeric) AS quantity_on_hand,
  (
    SELECT sm2.unit_cost
    FROM public.stock_movements sm2
    WHERE sm2.product_id = p.id
      AND sm2.movement_type = 'purchase'
      AND sm2.unit_cost IS NOT NULL
    ORDER BY sm2.created_at DESC
    LIMIT 1
  ) AS last_purchase_unit_cost,
  p.image_path
FROM public.products p;

GRANT SELECT ON public.product_inventory_snapshot TO authenticated;
GRANT SELECT ON public.product_inventory_snapshot TO anon;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "product_images_select" ON storage.objects;
DROP POLICY IF EXISTS "product_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_images_update" ON storage.objects;
DROP POLICY IF EXISTS "product_images_delete" ON storage.objects;

CREATE POLICY "product_images_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'product-images');

CREATE POLICY "product_images_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

CREATE POLICY "product_images_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

CREATE POLICY "product_images_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);
