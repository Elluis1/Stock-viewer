import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { mapAuthError } from './auth-messages';
import { passwordMatchValidator } from './password-match.validator';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly googleLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator },
  );

  constructor() {
    const oauthError = this.route.snapshot.queryParamMap.get('oauth_error');
    if (oauthError) {
      this.errorMessage.set(decodeURIComponent(oauthError.replace(/\+/g, ' ')));
      if (typeof history !== 'undefined') {
        history.replaceState(null, '', '/auth/register');
      }
    }
    const email = this.route.snapshot.queryParamMap.get('email')?.trim();
    if (email) {
      this.form.controls.email.setValue(email);
    }
  }

  get loginQueryParams(): Record<string, string> {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return returnUrl ? { returnUrl } : {};
  }

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    const { data, error } = await this.auth.signUp(
      this.form.controls.email.value,
      this.form.controls.password.value,
    );
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
    if (data.session) {
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      const url =
        returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')
          ? returnUrl
          : '/app/companies';
      await this.router.navigateByUrl(url);
      return;
    }
    this.successMessage.set(
      'Te enviamos un enlace de confirmación al correo. Cuando lo confirmes, podés iniciar sesión.',
    );
  }

  async signInWithGoogle(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.googleLoading.set(true);
    const { error } = await this.auth.signInWithGoogle();
    if (error) {
      this.googleLoading.set(false);
      this.errorMessage.set(mapAuthError(error.message));
      return;
    }
  }
}
