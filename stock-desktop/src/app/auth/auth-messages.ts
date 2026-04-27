/** Mensajes legibles para errores típicos de Supabase Auth (inglés → español). */
export function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('access_denied')) {
    return 'Cancelaste el acceso con Google.';
  }
  if (m.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (m.includes('email not confirmed')) {
    return 'Confirmá tu correo antes de entrar (revisá la bandeja de entrada).';
  }
  if (m.includes('user already registered')) {
    return 'Ese correo ya está registrado. Probá iniciar sesión.';
  }
  if (m.includes('password should be at least')) {
    return 'La contraseña no cumple los requisitos mínimos.';
  }
  if (m.includes('signup requires a valid password')) {
    return 'Contraseña no válida.';
  }
  return message;
}
