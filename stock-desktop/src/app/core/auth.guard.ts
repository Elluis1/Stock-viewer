import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SupabaseService } from './supabase.service';

export const authGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.client.auth.getSession();
  if (!data.session) {
    return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: router.url } });
  }
  return true;
};
