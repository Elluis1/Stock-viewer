# Deploy en Netlify (Stock Viewer)

## 1. Conectar el repo

1. Entrá a [app.netlify.com](https://app.netlify.com)
2. **Add new site → Import an existing project → GitHub**
3. Elegí `Elluis1/Stock-viewer` (o el nombre de tu repo)
4. Netlify debería leer `netlify.toml` de la raíz:
   - Base: `stock-desktop`
   - Build: `npm ci && npm run build`
   - Publish: `dist/stock-desktop/browser`
5. **Deploy site**

Cada **push a `main`** vuelve a desplegar solo.

## 2. Anotar la URL

Ejemplo: `https://algo-random.netlify.app`  
(más adelante podés poner dominio propio).

## 3. Supabase Auth (obligatorio)

**Authentication → URL Configuration**

- **Site URL:** `https://TU-SITIO.netlify.app`
- **Redirect URLs** (agregar, no borrar localhost):
  - `http://localhost:4200/**`
  - `https://TU-SITIO.netlify.app/**`
  - `https://TU-SITIO.netlify.app/auth/callback`
  - `https://TU-SITIO.netlify.app/auth/invitar`

Sin esto fallan Google login, invites y callbacks en prod.

## 4. Google OAuth (si lo usás)

En Google Cloud Console no cambia el redirect de Supabase (sigue siendo el de Supabase).  
Solo asegurá que en Supabase las Redirect URLs del punto 3 incluyan Netlify.

## 5. Flujo de trabajo diario

| Dónde | Qué |
|--------|-----|
| Local | `npm start` en `stock-desktop` |
| Prod | `git push` → Netlify rebuild automático |

## 6. Preview de ramas (opcional)

En Netlify podés activar **Deploy Previews** por Pull Request: cada PR tiene su URL de prueba.
