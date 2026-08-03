import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CompanyAccessService } from '../../core/company-access.service';
import { CompanyLogosService } from '../../core/company-logos.service';
import { SupabaseService } from '../../core/supabase.service';
import type { CompanyMemberRole } from '../../models/stock.types';

@Component({
  selector: 'app-company-edit',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './company-edit.component.html',
  styleUrl: './company-edit.component.scss',
})
export class CompanyEditComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly access = inject(CompanyAccessService);
  private readonly logos = inject(CompanyLogosService);

  readonly companyId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly role = signal<CompanyMemberRole | null>(null);
  readonly logoPath = signal<string | null>(null);
  readonly logoUrl = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
  });

  get canEdit(): boolean {
    return this.access.canEditCompanySettings(this.role());
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('companyId');
    if (!id) {
      this.loading.set(false);
      this.errorMessage.set('Empresa no encontrada.');
      return;
    }
    this.companyId.set(id);
    await this.load(id);
  }

  async onLogoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const companyId = this.companyId();
    if (!file || !companyId) {
      return;
    }
    if (!this.canEdit) {
      this.errorMessage.set('Solo owner o admin pueden cambiar la foto.');
      input.value = '';
      return;
    }
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.uploading.set(true);
    const { path, error } = await this.logos.uploadLogo({
      companyId,
      file,
      previousPath: this.logoPath(),
    });
    this.uploading.set(false);
    input.value = '';
    if (error) {
      this.errorMessage.set(error);
      return;
    }
    this.logoPath.set(path);
    this.logoUrl.set(this.logos.publicUrl(path));
    this.successMessage.set('Foto actualizada.');
  }

  async removeLogo(): Promise<void> {
    const companyId = this.companyId();
    const path = this.logoPath();
    if (!companyId || !path) {
      return;
    }
    if (!this.canEdit) {
      this.errorMessage.set('Solo owner o admin pueden quitar la foto.');
      return;
    }
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.uploading.set(true);
    const { error } = await this.logos.removeLogo({ companyId, path });
    this.uploading.set(false);
    if (error) {
      this.errorMessage.set(error);
      return;
    }
    this.logoPath.set(null);
    this.logoUrl.set(null);
    this.successMessage.set('Foto eliminada.');
  }

  async submit(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    if (!this.canEdit) {
      this.errorMessage.set('Solo owner o admin pueden editar la empresa.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const companyId = this.companyId();
    if (!companyId) {
      return;
    }
    this.saving.set(true);
    const { error } = await this.supabase.client
      .from('companies')
      .update({ name: this.form.controls.name.value.trim() })
      .eq('id', companyId);
    this.saving.set(false);
    if (error) {
      this.errorMessage.set(error.message);
      return;
    }
    this.successMessage.set('Cambios guardados.');
  }

  private async load(companyId: string): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    const [role, companyRes] = await Promise.all([
      this.access.getMyRole(companyId),
      this.supabase.client.from('companies').select('id,name,logo_path').eq('id', companyId).maybeSingle(),
    ]);
    this.role.set(role);
    if (companyRes.error) {
      this.loading.set(false);
      this.errorMessage.set(companyRes.error.message);
      return;
    }
    if (!companyRes.data) {
      this.loading.set(false);
      this.errorMessage.set('Empresa no encontrada.');
      return;
    }
    if (!this.access.canEditCompanySettings(role)) {
      this.loading.set(false);
      await this.router.navigate(['/app/companies', companyId, 'products']);
      return;
    }
    this.form.controls.name.setValue(String(companyRes.data.name ?? ''));
    const path = (companyRes.data.logo_path as string | null) ?? null;
    this.logoPath.set(path);
    this.logoUrl.set(this.logos.publicUrl(path));
    this.loading.set(false);
  }
}
