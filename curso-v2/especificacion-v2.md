# Especificación del curso v2 — 2026-08-31

Rediseño Opción A (recalibración) aprobado por Andrés con tres condiciones:
**(1)** basado en evidencia — ver `fundamentos-cientificos.md`; **(2)** sigue siendo de
**6 meses** (26 semanas × 7 días × 30 min); **(3)** conserva **mucha repetición** — memoria
muscular, no aprendizaje académico.

## Estructura que NO cambia
- 26 semanas, 182 días, 30 min/día, mismo HTML/app (secciones `day`, ejercicios con
  brief/pasos/observar/criterio, diagramas de acordes, metrónomo ♩, contador por micrófono).
- La filosofía de repetición: los mismos hilos aparecen **todos los días**; lo que progresa
  son los parámetros (BPM, progresión, patrón, traste).
- Canciones objetivo como trasfondo de aplicación.

## El día tipo (7 bloques, 30 min)
| # | Hilo | Min | Qué es |
|---|---|---|---|
| 1 | Activación | 2 | Postura + péndulo al aire. Siempre igual: ritual de entrada. |
| 2 | Arpegio digitado | 5 | p-i-m-a → p-a-m-i → i-m / **m-a** / a-m → p-m-a-m sobre progresiones. Hilo NUEVO (gap explícito, hoy inexistente). |
| 3 | Cejilla | 4 | Micro-dosis diaria desde el día 1: traste 7 → 5 → 3 → 1; parcial → completa; F → Bm. |
| 4 | Ritmo | 6 | Péndulo, corcheas, patrones (D-DU-UD-U…), acentos, síncopa, 6/8. Escalera de BPM. |
| 5 | Cambios | 4 | Pares de acordes a récord de 60 s con el contador por micrófono. |
| 6 | Voz + guitarra | 8 | Gap #1: contar → nombrar acordes → tararear → cantar grados → frases → canción completa. |
| 7 | Cierre | 1 | Una vuelta lenta perfecta + anotar récords del día en las notas de la app. |

El día 7 de cada semana es **test frío**: mismos 7 bloques, pero sin calentar y con registro
de resultados (BPM máximo, récord de cambios, cejilla que suena, compases cantados).

## Reglas de contenido (cero vaguedad)
1. Todo bloque nombra ejercicio, progresión, patrón y BPM del día. Prohibido "el ejercicio
   técnico" o "una progresión semanal" sin nombrarlos.
2. Todo bloque técnico usa criterio escalonado: "2 limpias → +5 BPM; 2 fallos → −5"; el éxito
   del día es el parámetro máximo alcanzado, y se anota.
3. La teoría que Andrés no sabe (intervalos, grados/romanos, inversiones) se conserva pero
   integrada en bloques prácticos (decir las notas/grados mientras se toca), no como lecciones
   de 6 min. La fórmula de tríadas (que ya sabe) desaparece como lección.
4. Referencias de mano/traste explicadas la primera vez por semana; después se asumen.

## Arco de 26 semanas (borrador de hilos)
- **S1** Línea base acelerada: todos los hilos arrancan; verificación de lo sabido en 1 min.
- **S2** F con cejilla parcial→completa; primera canción (C-G-Am-F) con voz.
- **S3-S5** Cambios por raíces, patrones de rasgueo completos, m-a estable; intervalos
  integrados; canción 2.
- **S6-S9** 6/8, arpegios de acompañamiento digitados por progresión; Bm; grados romanos
  integrados; cantar melodías sobre progresiones.
- **S10-S13** 12/8, síncopa; cejillas móviles (forma E y A); repertorio 3-4 canciones con voz.
- **S14-S18** Inversiones (G/B, D/F#) en contexto; dinámica y groove; arpegios mixtos
  (p-m-a-m, pulgar independiente); canciones completas cantadas de memoria.
- **S19-S26** Consolidación y repertorio: rotación de todo lo anterior con parámetros altos,
  tests fríos acumulativos, 5-6 canciones tocadas y cantadas enteras.

(El detalle semana a semana se genera en la fase final, después de probar la muestra.)

## Mecánica de publicación
- El original congelado (`original/curso_guitarra_6_meses_182_dias.html`) queda intacto como
  referencia.
- El contenido v2 vive en fragmentos `original/curso-v2-*.html`; `build.py` reemplaza las
  secciones `data-day` correspondientes al armar `docs/`.
- Los fragmentos se generan con `tools/gen_v2_sample.py`, que copia los diagramas de acordes
  del original (misma fuente visual).
- **Fase de muestra (actual):** `curso-v2-semanas-1-2.html` reemplaza los días 1-14. Andrés lo
  prueba unos días; con su feedback se generan las 26 semanas.
