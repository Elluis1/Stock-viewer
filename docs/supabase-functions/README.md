# Envío automático de invitaciones (Resend + Edge Function)

Sin esto, el botón **Enviar por correo** intenta la Edge Function y, si falla, abre tu cliente de correo (**Abrir en mi correo**).

## 1. Cuenta Resend

1. Creá cuenta en [resend.com](https://resend.com)
2. Creá un API key
3. (Prod) Verificá un dominio; en pruebas podés usar `onboarding@resend.dev` solo hacia tu propio email

## 2. Desplegar la función

Desde la raíz del repo (con [Supabase CLI](https://supabase.com/docs/guides/cli) logueado):

```bash
supabase functions deploy send-company-invite --project-ref qgqazwwbeoropymqhqwn
supabase secrets set RESEND_API_KEY=re_xxxxxxxxx --project-ref qgqazwwbeoropymqhqwn
supabase secrets set INVITE_FROM_EMAIL="Stock Desktop <onboarding@resend.dev>" --project-ref qgqazwwbeoropymqhqwn
```

El código de la función está en:

- `docs/supabase-functions/send-company-invite/index.ts`
- `supabase/functions/send-company-invite/index.ts`

## 3. SQL de permisos owner

Ejecutá también en el SQL Editor:

`docs/sql/000007c_owner_cannot_leave.sql`
