import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { mapAuthError } from './auth-messages';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly googleLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    const oauthError = this.route.snapshot.queryParamMap.get('oauth_error');
    if (oauthError) {
      this.errorMessage.set(decodeURIComponent(oauthError.replace(/\+/g, ' ')));
      if (typeof history !== 'undefined') {
        history.replaceState(null, '', '/auth/login');
      }
    }
  }

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    const { error } = await this.auth.signIn(this.form.controls.email.value, this.form.controls.password.value);
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    await this.postLoginNavigate();
  }

  private async postLoginNavigate(): Promise<void> {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/app/companies';
    const url = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app/companies';
    await this.router.navigateByUrl(url);
  }

  async signInWithGoogle(): Promise<void> {
    this.errorMessage.set(null);
    this.googleLoading.set(true);
    const { error } = await this.auth.signInWithGoogle();
    if (error) {
      this.googleLoading.set(false);
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
  }
}
