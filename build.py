#!/usr/bin/env python3
"""Genera docs/ (la PWA publicable) a partir de original/ + assets/.

El contenido del curso (original/curso_guitarra_6_meses_182_dias.html) está
aprobado y NO se edita: este build solo inyecta el runtime de la app
(manifest, service worker, CSS y JS) alrededor de ese contenido.
"""
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
ORIGINAL = ROOT / "original" / "curso_guitarra_6_meses_182_dias.html"
ASSETS = ROOT / "assets"
DOCS = ROOT / "docs"

HEAD_INJECT = """<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0e1116">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Guitarra">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" href="icons/icon-192.png">
<link rel="stylesheet" href="app.css?v={v}">
"""

BODY_INJECT = """<script defer src="app.js?v={v}"></script>
<script>if('serviceWorker' in navigator){{addEventListener('load',()=>{{
navigator.serviceWorker.register('sw.js').then(r=>{{r.update();
document.addEventListener('visibilitychange',()=>{{if(document.visibilityState==='visible')r.update()}})}});
/* cuando el SW nuevo toma control, recargar para no quedar con app.js viejo + cache nuevo */
let had=!!navigator.serviceWorker.controller;
navigator.serviceWorker.addEventListener('controllerchange',()=>{{if(had)location.reload();had=true}});
}})}}</script>
"""


def main():
    html = ORIGINAL.read_text(encoding="utf-8")
    # viewport con viewport-fit para el notch (solo atributo, no contenido)
    html = html.replace(
        'content="width=device-width,initial-scale=1"',
        # maximum-scale=1 evita el auto-zoom de iOS al enfocar inputs (y que quede
        # mal el zoom al cerrar el teclado); el pinch manual no se usa en la app
        'content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"',
    )

    DOCS.mkdir(exist_ok=True)
    for name in ("app.css", "app.js", "manifest.webmanifest"):
        shutil.copy(ASSETS / name, DOCS / name)

    # muestras de guitarra (VSCO2 CE, dominio público) → docs/samples/
    samples = sorted((ASSETS / "samples").glob("*.mp3"))
    (DOCS / "samples").mkdir(exist_ok=True)
    for p in samples:
        shutil.copy(p, DOCS / "samples" / p.name)

    icons = DOCS / "icons"
    if not (icons / "icon-512.png").exists():
        subprocess.run([sys.executable, str(ROOT / "tools" / "make_icons.py")], check=True)

    # fragmentos v2 (rediseño aprobado 2026-08-31): reemplazan días completos
    v2_frags = sorted(ROOT.glob("original/curso-v2-*.html"))

    # versión = hash del contenido que cachea el SW
    h = hashlib.sha1()
    for p in [ORIGINAL, ASSETS / "app.css", ASSETS / "app.js", ASSETS / "sw.js"] + samples + v2_frags:
        h.update(p.read_bytes())
    version = h.hexdigest()[:10]

    # Cambios de contenido aprobados por Andrés:
    # A3 (VB 2026-08-30) — afinación antes de cada sesión.
    # A4 (VB 2026-08-30, reescrito 2026-08-31) — usar el metrónomo integrado.
    # A5 (pedido 2026-08-31) — el curso decía "Moises a X BPM"; Andrés no usa
    # Moises: se reemplaza por "Metrónomo a X BPM" (el de la app, botón ♩).
    html = re.sub(r"Moises( a)? (\d+ BPM)", r"Metrónomo a \2", html)
    html = html.replace(
        "<h3>Cómo usar los BPM</h3>",
        "<h3>Antes de empezar: afina</h3><p>Afina la guitarra antes de cada sesión "
        "(pestaña <b>Afinador</b> de esta app): practicar con la guitarra desafinada "
        "entrena mal el oído y hace sonar sucio lo que está bien tocado.</p>"
        "<h3>Cómo usar los BPM</h3>",
        1,
    )
    html = html.replace(
        "velocidad sin control no cuenta como progreso.</p>",
        "velocidad sin control no cuenta como progreso. El metrónomo es el "
        "integrado de esta app (botón ♩): ponle los BPM que pida el ejercicio.</p>",
        1,
    )

    # v2: cada sección <section class="day"> de un fragmento reemplaza a la del
    # mismo data-day en el original (el original en disco queda intacto)
    for frag in v2_frags:
        ftext = frag.read_text(encoding="utf-8")
        secs = re.findall(r'<section class="day"[^>]*>.*?</section>', ftext, re.S)
        for sec in secs:
            day = re.search(r'data-day="(\d+)"', sec).group(1)
            pat = re.compile(
                rf'<section class="day" id="day-{day}" data-day="{day}"[^>]*>.*?</section>',
                re.S,
            )
            html, n = pat.subn(lambda _m, s=sec: s, html, count=1)
            if n != 1:
                raise SystemExit(f"{frag.name}: no encontré el día {day} en el original")
        print(f"v2: {frag.name} reemplazó {len(secs)} días")

    # el CSS de la app va al FINAL del <head>, después del <style> del curso,
    # para que sus reglas (safe areas, paddings) ganen en la cascada
    html = html.replace("</head>", HEAD_INJECT.format(v=version) + "</head>", 1)
    html = html.replace("</body>", BODY_INJECT.format(v=version) + "</body>", 1)
    (DOCS / "index.html").write_text(html, encoding="utf-8")

    sample_list = "".join(f",\n  './samples/{p.name}'" for p in samples)
    sw = (
        (ASSETS / "sw.js")
        .read_text(encoding="utf-8")
        .replace("__VERSION__", version)
        .replace("/* __SAMPLE_ASSETS__ */", sample_list)
    )
    (DOCS / "sw.js").write_text(sw, encoding="utf-8")

    total = sum(p.stat().st_size for p in DOCS.rglob("*") if p.is_file())
    print(f"docs/ generado · versión {version} · {total/1024:.0f} KB")


if __name__ == "__main__":
    main()
