import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../core/supabase.service';

@Component({
  selector: 'app-auth-callback',
  imports: [],
  templateUrl: './auth-callback.component.html',
  styleUrl: './auth-callback.component.scss',
})
export class AuthCallbackComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const oauthError = search.get('error_description') ?? search.get('error') ?? hash.get('error_description') ?? hash.get('error');

    if (oauthError) {
      await this.router.navigate(['/auth/login'], {
        queryParams: { oauth_error: oauthError },
      });
      return;
    }

    const code = search.get('code');
    if (code) {
      const { error } = await this.supabase.client.auth.exchangeCodeForSession(code);
      if (error) {
        await this.router.navigate(['/auth/login'], {
          queryParams: { oauth_error: error.message },
        });
        return;
      }
    }

    const {
      data: { session },
    } = await this.supabase.client.auth.getSession();
    if (session) {
      await this.router.navigateByUrl('/app/companies');
      return;
    }

    await this.router.navigate(['/auth/login'], {
      queryParams: { oauth_error: 'No se pudo completar el inicio de sesión.' },
    });
  }
}
