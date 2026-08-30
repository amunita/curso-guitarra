# Curso de guitarra · webapp

PWA offline del curso de guitarra de 6 meses (182 sesiones). El contenido del curso está
aprobado y vive congelado en `original/`; la app agrega funcionalidad alrededor sin editarlo.

## Estructura
- `original/curso_guitarra_6_meses_182_dias.html` — contenido aprobado (NO editar sin VB de Andrés).
- `assets/` — runtime de la app: `app.css`, `app.js`, `sw.js`, `manifest.webmanifest`.
- `tools/make_icons.py` — genera los íconos (requiere Pillow).
- `build.py` — arma `docs/` (la app publicable).
- `docs/` — resultado del build; es lo que se sirve/publica.

## Build y prueba local
```bash
python3 build.py
python3 -m http.server 8765 -d docs   # abrir http://localhost:8765
```

## Funcionalidad agregada
- **Offline**: service worker cache-first; instalable en iPhone/iPad (Añadir a pantalla de inicio).
- **Estado**: retoma el último día visto; días completados con ✓ (localStorage).
- **Sonido**: cuerdas de nylon por síntesis Karplus-Strong (sin samples, todo offline).
  Tocar cualquier diagrama de acorde lo hace sonar; las demos tocan las notas del ejercicio.
- **Modo sesión** (`▶ Iniciar sesión` en cada día): un ejercicio a la vez, sin scroll,
  cronómetro por ejercicio con aviso sonoro + flash al terminar, repetir/siguiente,
  metrónomo y demo a mano, pantalla siempre encendida (wake lock).
- **Metrónomo** estilo Moises: flotante, BPM y compás; si está activo, las demos parten
  con un compás de count-in y suenan con clic.
- **Canciones**: hojas de letra+acordes (acordes arriba, tocables); las 3 canciones objetivo
  vienen precargadas solo con acordes — las letras las pega Andrés desde su hoja legal.
- **Referencia**: buscador de acordes del curso (búsqueda en cifrado americano o latino)
  y mapa de notas en el diapasón (traste 0–12) con audio.

## Notas iOS
- El audio parte tras el primer toque (restricción de iOS) y respeta el switch de silencio.
- Wake lock requiere iOS ≥ 16.4.

## Publicación
Pendiente de VB: servir `docs/` por HTTPS (p. ej. GitHub Pages) para poder instalarla como PWA.
El repo git es local; no hay remoto.
