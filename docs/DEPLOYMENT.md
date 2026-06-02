# Despliegue

El despliegue sigue el patron usado en `ontour`, adaptado a React/Vite:

```text
Vite build -> frontend/dist/
Cloudflare Pages -> sirve frontend/dist/
Dominio custom -> opcional
```

## Produccion actual

- URL Pages fallback: `https://simlab-dum.pages.dev`
- Preview del ultimo deploy manual: `https://16bd9906.simlab-dum.pages.dev`
- Cloudflare Pages project: `simlab`
- Cloudflare Pages domain actual: `simlab-dum.pages.dev`
- Build output: `frontend/dist`
- Backend FastAPI: no incluido en Cloudflare Pages en esta fase

Si se configura un dominio custom, el registro DNS recomendado es:

```text
type: CNAME
name: simlab
target: simlab-dum.pages.dev
proxied: true
```

Para cambios DNS automatizados se uso el token `CLOUDFLARE_API_TOKEN` ya empleado en `ontour`; no se guarda en el repositorio.

## Desarrollo local

Frontend Vite:

```bash
cd frontend
npm install
npm run dev
```

Preview local con Pages:

```bash
cd frontend
npm run pages:dev
```

## Deploy manual

Desde `frontend/`:

```bash
npm run deploy
```

El script ejecuta:

```bash
npm run build
wrangler pages deploy dist --project-name simlab
```

## Configuracion en Cloudflare Pages

Si se conecta el repo desde el dashboard:

- Project name: `simlab`
- Framework preset: `Vite`
- Build command: `cd frontend && npm ci && npm run build`
- Build output directory: `frontend/dist`
- Production branch: `principal`
- Custom domain: opcional

El archivo [wrangler.toml](../wrangler.toml) deja documentado el nombre del proyecto y la carpeta de salida.

## Backend

La API FastAPI local sigue siendo una capa desacoplada para persistencia, proyectos y simulaciones oficiales. Cloudflare Pages no ejecuta Python, asi que para produccion hay dos rutas razonables:

1. Mantener `simlab` como frontend estatico y desplegar FastAPI en un servicio separado.
2. Migrar las rutas necesarias a Cloudflare Pages Functions/Workers si se quiere una arquitectura mas parecida a `ontour`.

Mientras la UI use simulacion en cliente, Cloudflare Pages basta para publicar la herramienta visual.
