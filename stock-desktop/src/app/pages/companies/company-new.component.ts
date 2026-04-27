import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';

@Component({
  selector: 'app-company-new',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './company-new.component.html',
  styleUrl: './company-new.component.scss',
})
export class CompanyNewComponent {
  private readonly fb = inject(FormBuilder);
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
  });

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    const { data, error } = await this.supabase.client.rpc('create_company', {
      p_name: this.form.controls.name.value.trim(),
    });
    this.loading.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    const id = data as string;
    await this.router.navigate(['/app/companies', id, 'products']);
  }
}
