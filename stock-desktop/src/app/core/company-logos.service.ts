import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

const BUCKET = 'company-logos';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@Injectable({ providedIn: 'root' })
export class CompanyLogosService {
  private readonly supabase = inject(SupabaseService);

  publicUrl(path: string | null | undefined): string | null {
    if (!path) {
      return null;
    }
    const { data } = this.supabase.client.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  }

  validateFile(file: File): string | null {
    if (!ALLOWED.has(file.type)) {
      return 'Usá JPG, PNG, WEBP o GIF.';
    }
    if (file.size > MAX_BYTES) {
      return 'La imagen no puede superar 5 MB.';
    }
    return null;
  }

  async uploadLogo(params: {
    companyId: string;
    file: File;
    previousPath?: string | null;
  }): Promise<{ path: string | null; error: string | null }> {
    const validation = this.validateFile(params.file);
    if (validation) {
      return { path: null, error: validation };
    }

    const ext = this.extensionFor(params.file);
    const path = `${params.companyId}/${Date.now()}.${ext}`;

    const { error: upErr } = await this.supabase.client.storage.from(BUCKET).upload(path, params.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: params.file.type,
    });
    if (upErr) {
      return { path: null, error: upErr.message };
    }

    const { error: updErr } = await this.supabase.client
      .from('companies')
      .update({ logo_path: path })
      .eq('id', params.companyId);

    if (updErr) {
      await this.supabase.client.storage.from(BUCKET).remove([path]);
      return { path: null, error: updErr.message };
    }

    if (params.previousPath && params.previousPath !== path) {
      await this.supabase.client.storage.from(BUCKET).remove([params.previousPath]);
    }

    return { path, error: null };
  }

  async removeLogo(params: {
    companyId: string;
    path: string;
  }): Promise<{ error: string | null }> {
    const { error: updErr } = await this.supabase.client
      .from('companies')
      .update({ logo_path: null })
      .eq('id', params.companyId);
    if (updErr) {
      return { error: updErr.message };
    }
    await this.supabase.client.storage.from(BUCKET).remove([params.path]);
    return { error: null };
  }

  private extensionFor(file: File): string {
    switch (file.type) {
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      case 'image/gif':
        return 'gif';
      default:
        return 'jpg';
    }
  }
}
