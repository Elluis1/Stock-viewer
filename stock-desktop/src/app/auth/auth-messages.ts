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
  if (m.includes('verification disabled') || m.includes('mfa verification is disabled')) {
    return 'La verificación MFA está desactivada en Supabase (Authentication → Multi-factor). Activá la verificación TOTP.';
  }
  if (m.includes('challenge') && (m.includes('expired') || m.includes('invalid'))) {
    return 'El desafío de 2FA venció. Volvé a ingresar el código de 6 dígitos de inmediato (generá uno nuevo en la app).';
  }
  if (m.includes('mfa') && m.includes('verification')) {
    return 'Código incorrecto o vencido. Probá de nuevo.';
  }
  if (m.includes('invalid') && m.includes('otp')) {
    return 'Código de autenticador inválido.';
  }
  if (m.includes('too many requests')) {
    return 'Demasiados intentos. Esperá un momento y probá de nuevo.';
  }
  return message;
}
