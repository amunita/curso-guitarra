# Auditoría del curso (182 días) contra el nivel real de Andrés — 2026-08-31

Fuente: `original/curso_guitarra_6_meses_182_dias.html` (911 bloques de ejercicio en 182 días,
26 semanas × 30 min). Método: parseo completo + análisis de los 95 ejercicios únicos.

## Perfil declarado por Andrés (2026-08-31)
- **Sabe:** acordes mayores básicos (A-C-D-E-G); teoría de tríadas (0-4-7 mayor, 0-3-7 menor);
  rasgueo básico sin orden; arpegio simple p-m-a; toca canciones simples.
- **Le cuesta (de más a menos):** (1) coordinación manos+voz — lejos lo peor; (2) cejilla en
  general, F y B y variantes; (3) técnica de rasgueo ordenada; (4) arpegios que no sean p-m-a
  (m-a le cuesta mucho); (5) cambios entre acordes; (6) postura de mano.
- **Quiere:** 30 min/día bien aprovechados; le gusta el trasfondo (repetición + ejercicio).

## Hallazgos

### H1 · El curso asume principiante absoluto (S1–S3)
Semanas 1–3 dedican ~40% del tiempo a enseñar qué es un traste, cuál es la 1ª cuerda,
qué es i-m, y la fórmula de tríadas que él ya domina ("Teoría · tríadas" son 41-42 min/semana
las 2 primeras semanas, contenido que él declara saber). Diagnóstico de "demasiado fácil": correcto
para teoría y mecánica básica; **incorrecto para ritmo**: el hilo "pulso y péndulo" (mano derecha
como péndulo, corcheas, acentos) apunta exactamente a su gap #3 y no debería recortarse.

### H2 · 90% de repetición literal
De 911 bloques, solo 95 son distintos. Ejemplos: "Ritmo · groove y dinámica" se repite
**112 veces idéntico** (solo cambia la progresión/BPM del encabezado), "Técnica · elección
eficiente" ×42, "Teoría · romanos" ×35, "Análisis · canción nueva" ×35. La repetición es la
filosofía del curso (bien), pero repetir la *misma lección teórica* 35 veces no es repetición
de práctica, es relleno.

### H3 · Sus brechas vs el peso que les da el curso
| Brecha (su orden) | Cobertura en el curso | Veredicto |
|---|---|---|
| 1. Manos+voz | Hilo diario desde D1 (bien diseñado, escala de dificultad real) | ✅ pero solo 6 min/día — subponderado para su gap #1 |
| 2. Cejilla/F/B | S4 (F progresivo) y S9 (F/Bm); luego solo menciones en S21+ | 🔴 tardía y aislada: 2 semanas concentradas en vez de dosis diaria |
| 3. Rasgueo ordenado | Péndulo S1-3, corcheas S3+, 6/8 S6, 12/8 S10, síncopa S11 | ✅ bien cubierto y bien secuenciado |
| 4. Arpegio digitado (m-a) | **INEXISTENTE**: ningún ejercicio p-i-m-a en 182 días. Las semanas "6/8 y arpegios" (S6) y "Arpegio de acompañamiento" (S12) no contienen ningún ejercicio de digitación; "arpegio" aparece solo como "capa" opcional | 🔴 el gap que él nombra explícito no se entrena nunca |
| 5. Cambios de acordes | S2 + "cambios por raíces" S5-S8 con escalera de BPM | ✅ |
| 6. Postura | D1 (3 min) + recordatorios en "Observar" | ⚠️ suficiente si se mantiene el recordatorio |
| Teoría que NO sabe | Intervalos (S3), grados/romanos (S6/S9), inversiones (S14) | ✅ mantener — esto sí es nuevo para él |

### H4 · Instrucciones vagas (49 bloques)
Concentradas en 2 plantillas: "Integración · práctica intercalada" (×23: "45 s ejercicio
técnico" sin decir cuál) y "Consolidación semanal" (×26: "el concepto teórico semanal",
"el ejercicio técnico", "una progresión semanal" — puras referencias sin contenido).
Es exactamente lo que Andrés reportó con la foto de la sesión 2.

### H5 · Minutos mal calibrados (21 bloques detectados + patrón general)
- 6-7 min para criterios que se logran en <1 min ("2 recorridos limpios").
- Al revés: cejilla (su técnica más dura) recibe los mismos 6 min planos que todo lo demás.
- El patrón sano existe en algunos bloques ("si dos salen limpios, sube 5 BPM") pero no está
  generalizado: el criterio de éxito no escala para llenar el tiempo asignado.

## Propuesta de rediseño (requiere VB)

**Opción A — recalibración (recomendada):** mantener estructura (26 semanas, 30 min, hilos
técnica/ritmo/teoría/voz/integración, canciones objetivo) y regenerar el contenido con estos
lineamientos:
1. **S1-S3 → 1 semana de línea base acelerada**: lo que sabe pasa a verificación de 1 min
   (checklist), no lección de 6. Libera ~2 semanas.
2. **Reponderar el día tipo**: manos+voz sube a 8-10 min diarios; **cejilla en micro-dosis
   diaria de 4-5 min desde S2** (la evidencia de técnica dura favorece dosis cortas diarias
   sobre semanas concentradas); nuevo **hilo de arpegio digitado** desde S2: p-i-m-a →
   p-m-a-m → i-m/m-a/a-m aislados (su gap) → patrones de acompañamiento.
3. **Cero referencias vagas**: cada bloque de integración/consolidación nombra el ejercicio,
   la progresión y el BPM del día.
4. **Criterio escalonado en todo bloque técnico**: "2 limpias → +5 BPM → repite" hasta agotar
   los minutos; el éxito del día es el BPM máximo alcanzado (medible, y aprovecha el contador
   por micrófono de la app).
5. **Repetición con progresión real**: los bloques ×35-×112 conservan la mecánica pero varían
   progresión, tono, patrón o exigencia cada día.

**Opción B — v2 desde cero** a partir del perfil. Más trabajo y pierde el trasfondo que le gusta.

**Mecánica en ambos casos:** el original congelado queda como referencia; la v2 vive como
archivo nuevo (`original/curso-v2-*.html`) que el build usa tras el VB. Fases: (1) VB de estos
lineamientos → (2) genero semanas 1-2 de muestra y Andrés las prueba unos días → (3) genero
las 26 semanas.

## Muestras de reescritura (calibrar nivel de detalle)

**"Integración · práctica intercalada" (la de la foto) — antes:** 45 s progresión con negras /
45 s ejercicio técnico / 45 s progresión + conteo/tarareo / repite / termina limpio.
**Después:** 1) 45 s: C-G-Am-F, un rasgueo ↓ por pulso, 60 BPM. 2) 45 s: 1-3-2-4 en trastes
5-8, cuerdas 6ª y 5ª, una nota por clic. 3) 45 s: C-G-Am-F diciendo el nombre del acorde justo
al cambiar. 4) Repite la ronda (2 rondas = 4,5 min). 5) Cierre: 1 vuelta lenta perfecta.
Éxito: la 2ª ronda sale igual o mejor que la 1ª.

**Bloque técnico con criterio escalonado — antes:** 6 min, "éxito: 2 recorridos limpios".
**Después:** 6 min de escalera: parte a 60 BPM; cada 2 recorridos limpios sube 5 BPM; 2 fallos
seguidos, baja 5. Éxito del día: el BPM máximo con 2 limpias (anótalo en las notas).

**Nuevo bloque de arpegio digitado (hilo inexistente hoy):** Am, 6 min: 1 min p-i-m-a
ascendente (p=5ª, i=3ª, m=2ª, a=1ª); 1 min p-a-m-i; sin pulgar: 30 s i-m, 90 s m-a (tu gap:
solo medio y anular, parejos), 30 s a-m; 2 min p-m-a-m alternando Am→C sin frenar el patrón.
Éxito: 8 compases de m-a parejos a 60 BPM.
