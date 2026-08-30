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
<meta name="theme-color" content="#17212b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Guitarra">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" href="icons/icon-192.png">
<link rel="stylesheet" href="app.css?v={v}">
"""

BODY_INJECT = """<script defer src="app.js?v={v}"></script>
<script>if('serviceWorker' in navigator){{addEventListener('load',()=>navigator.serviceWorker.register('sw.js'))}}</script>
"""


def main():
    html = ORIGINAL.read_text(encoding="utf-8")
    # viewport con viewport-fit para el notch (solo atributo, no contenido)
    html = html.replace(
        'content="width=device-width,initial-scale=1"',
        'content="width=device-width,initial-scale=1,viewport-fit=cover"',
    )

    DOCS.mkdir(exist_ok=True)
    for name in ("app.css", "app.js", "manifest.webmanifest"):
        shutil.copy(ASSETS / name, DOCS / name)

    icons = DOCS / "icons"
    if not (icons / "icon-512.png").exists():
        subprocess.run([sys.executable, str(ROOT / "tools" / "make_icons.py")], check=True)

    # versión = hash del contenido que cachea el SW
    h = hashlib.sha1()
    for p in [ORIGINAL, ASSETS / "app.css", ASSETS / "app.js", ASSETS / "sw.js"]:
        h.update(p.read_bytes())
    version = h.hexdigest()[:10]

    html = html.replace("</title>", "</title>\n" + HEAD_INJECT.format(v=version), 1)
    html = html.replace("</body>", BODY_INJECT.format(v=version) + "</body>", 1)
    (DOCS / "index.html").write_text(html, encoding="utf-8")

    sw = (ASSETS / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", version)
    (DOCS / "sw.js").write_text(sw, encoding="utf-8")

    total = sum(p.stat().st_size for p in DOCS.rglob("*") if p.is_file())
    print(f"docs/ generado · versión {version} · {total/1024:.0f} KB")


if __name__ == "__main__":
    main()
