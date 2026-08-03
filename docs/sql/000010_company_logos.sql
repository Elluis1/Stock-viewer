-- 000010_company_logos.sql
-- Logos de empresa en Supabase Storage (bucket company-logos)
-- Aplicado en remoto como company_logos

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_path text;

COMMENT ON COLUMN public.companies.logo_path IS
  'Path relativo en bucket company-logos (ej. companyId/timestamp.webp).';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "company_logos_select" ON storage.objects;
DROP POLICY IF EXISTS "company_logos_insert" ON storage.objects;
DROP POLICY IF EXISTS "company_logos_update" ON storage.objects;
DROP POLICY IF EXISTS "company_logos_delete" ON storage.objects;

CREATE POLICY "company_logos_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-logos');

CREATE POLICY "company_logos_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

CREATE POLICY "company_logos_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'company-logos'
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

CREATE POLICY "company_logos_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND public.is_owner_or_admin_of_company(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);
