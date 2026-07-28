import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SupabaseService } from './supabase.service';

/** Si ya hay sesión, no mostrar la landing pública: ir directo a la app. */
export const redirectIfAuthenticatedGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.client.auth.getSession();
  if (data.session) {
    return router.createUrlTree(['/app/companies']);
  }
  return true;
};
