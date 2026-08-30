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
- **Hoy** (inicio): anillo de progreso, racha 🔥, tarjeta del próximo día con «Empezar la
  sesión de hoy», acceso al calendario de progreso y al envío de feedback.
- **Offline**: service worker cache-first; instalable en iPhone/iPad (Añadir a pantalla de inicio).
- **Estado**: retoma el último día visto; días completados con ✓ y fecha (localStorage).
- **Sonido**: cuerdas de nylon por síntesis Karplus-Strong (sin samples, todo offline).
  Tocar cualquier diagrama de acorde lo hace sonar; las demos tocan las notas del ejercicio,
  con patrón de rasgueo detectado del texto (abajo-arriba, síncopa, 6/8, 12/8, arpegio) y
  BPM ajustable por demo.
- **Diagramas mejorados**: números de dedo sobre los puntos y notas del acorde (Do·Mi·Sol)
  bajo cada diagrama.
- **Modo sesión** (`▶ Iniciar sesión` en cada día): un ejercicio a la vez, sin scroll, puntos
  de avance, cronómetro por ejercicio con aviso sonoro + flash al terminar, repetir/siguiente,
  metrónomo y demo a mano, pantalla siempre encendida (wake lock), notas del día al cerrar.
- **Metrónomo** estilo Moises: flotante, BPM (slider + TAP) y compás; si está activo, las
  demos parten con un compás de count-in y suenan con clic.
- **Afinador** con micrófono (estilo GuitarTuna): detección de tono por autocorrelación,
  aguja de cents, AUTO por cuerda o cuerda fija con tono de referencia. Requiere HTTPS.
- **Canciones**: hojas de letra+acordes (acordes arriba, tocables); las 3 canciones objetivo
  vienen precargadas solo con acordes — las letras las pega Andrés desde su hoja legal.
- **Referencia**: buscador de acordes (americano o latino), mapa de notas en el diapasón
  y respaldo del progreso (exportar/importar JSON).
- **Notas y feedback**: notas personales por día; botón «Enviar notas y feedback» que arma
  un correo a andres@nikolaventures.com con progreso + notas.

## Notas iOS
- El audio parte tras el primer toque (restricción de iOS) y respeta el switch de silencio.
- Wake lock requiere iOS ≥ 16.4; el micrófono del afinador requiere HTTPS.

## Publicación
GitHub Pages sirve `docs/` desde la rama `main`. Publicar = commit + `git push`.
