import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CompanyLogosService } from '../../core/company-logos.service';
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
  private readonly logos = inject(CompanyLogosService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly logoFile = signal<File | null>(null);
  readonly logoPreviewUrl = signal<string | null>(null);
  readonly logoFileName = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
  });

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.clearLogoPreview();
    if (!file) {
      this.logoFile.set(null);
      this.logoFileName.set(null);
      return;
    }
    const err = this.logos.validateFile(file);
    if (err) {
      this.errorMessage.set(err);
      input.value = '';
      this.logoFile.set(null);
      this.logoFileName.set(null);
      return;
    }
    this.errorMessage.set(null);
    this.logoFile.set(file);
    this.logoFileName.set(file.name);
    this.logoPreviewUrl.set(URL.createObjectURL(file));
  }

  clearLogoSelection(input?: HTMLInputElement): void {
    this.clearLogoPreview();
    this.logoFile.set(null);
    this.logoFileName.set(null);
    if (input) {
      input.value = '';
    }
  }

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
    if (error) {
      this.loading.set(false);
      this.errorMessage.set(error.message);
      return;
    }
    const id = data as string;
    const pending = this.logoFile();
    if (pending) {
      const { error: logoErr } = await this.logos.uploadLogo({ companyId: id, file: pending });
      if (logoErr) {
        this.loading.set(false);
        this.errorMessage.set(`Empresa creada, pero la foto falló: ${logoErr}`);
        await this.router.navigate(['/app/companies', id, 'editar']);
        return;
      }
    }
    this.loading.set(false);
    await this.router.navigate(['/app/companies', id, 'products']);
  }

  private clearLogoPreview(): void {
    const prev = this.logoPreviewUrl();
    if (prev) {
      URL.revokeObjectURL(prev);
    }
    this.logoPreviewUrl.set(null);
  }
}
