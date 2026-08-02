import { Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'stock-desktop-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(this.readStoredPreference());
  readonly resolved = signal<ResolvedTheme>(this.resolve(this.preference()));

  private media: MediaQueryList | null = null;

  constructor() {
    this.apply(this.resolved());
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.media = window.matchMedia('(prefers-color-scheme: dark)');
      this.media.addEventListener('change', () => {
        if (this.preference() === 'system') {
          this.apply(this.resolve('system'));
        }
      });
    }
  }

  setPreference(next: ThemePreference): void {
    this.preference.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    this.apply(this.resolve(next));
  }

  /** Alterna entre claro y oscuro (sale de “system”). */
  toggleLightDark(): void {
    const next: ThemePreference = this.resolved() === 'dark' ? 'light' : 'dark';
    this.setPreference(next);
  }

  private resolve(preference: ThemePreference): ResolvedTheme {
    if (preference === 'light' || preference === 'dark') {
      return preference;
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  private apply(theme: ResolvedTheme): void {
    this.resolved.set(theme);
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.setAttribute('data-theme', theme);
  }

  private readStoredPreference(): ThemePreference {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'system') {
        return raw;
      }
    } catch {
      /* ignore */
    }
    return 'system';
  }
}
