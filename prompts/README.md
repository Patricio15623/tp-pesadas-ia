# Prompts del aviso

El prompt vigente está en `simulador/reglas.js` (constante `PROMPT_SISTEMA`) y se copia al flujo de n8n con `scripts/armar_flujo.py`. Acá queda documentada su evolución, que forma parte de la metodología del trabajo.

## Versión 1: pedirle todo a la IA

```text
Resumí esta pesada de camión para mandarla por Telegram: {JSON de la pesada}
```

**Riesgo identificado:** la IA queda a cargo de las cuentas (neto, merma por humedad, comparaciones) y puede equivocarse o inventar cifras con total seguridad. En una balanza un número mal escrito no es un detalle: termina en una liquidación a un proveedor. Además, el formato no queda definido y cambia de un mensaje a otro.

## Versión 2: reglas dentro del prompt

Se agregaron al prompt las fórmulas (merma = (H − base) / (100 − base)) y los umbrales de alerta, pidiéndole a la IA que los aplique.

**Riesgo identificado:** el prompt crece y depende de que el modelo haga bien la aritmética y la comparación con el historial. Cambiar un umbral obliga a reescribir texto y no hay forma de probarlo automáticamente.

## Versión 3 (vigente): la IA redacta, el código calcula y controla

Se separaron las responsabilidades:

1. **Código (`reglas.js`):** calcula neto, merma y desvíos contra el historial, y define alertas y nivel. También procesa las lecturas de las cámaras de patentes. Tiene 33 pruebas automáticas (`node scripts/test_reglas.js`).
2. **IA (Claude Haiku):** recibe las cifras **ya formateadas** (`cifras_texto`) y las alertas, y solo redacta un aviso claro y priorizado.
3. **Código (validador):** controla el texto de la IA antes de enviarlo:
   - tiene que mencionar la patente y el neto exacto;
   - cualquier número seguido de "kg" tiene que existir entre las cifras calculadas;
   - no puede superar los 900 caracteres ni usar Markdown;
   - en ATENCIÓN o CRÍTICO tiene que cerrar con la sugerencia (👉), y no puede venir cortado por el límite de tokens.

   Si no pasa el control, se envía la **plantilla fija** e igual llega el aviso.

Prompt de sistema vigente:

```text
Sos el asistente de la balanza de una planta de alimento balanceado.
Tu unica tarea es redactar un aviso breve para Telegram sobre un evento de la balanza (una pesada cerrada o un camion que no se peso).

REGLAS OBLIGATORIAS:
1. Usa SOLO los datos del JSON que te paso. No calcules ni inventes cifras: copia los kilos exactamente como vienen en 'cifras_texto'.
2. Siempre inclui la patente. Si 'cifras_texto' trae NETO, incluilo.
3. Si hay alertas, listalas de la mas grave a la menos grave, una por linea, en lenguaje simple. No antepongas la severidad (CRITICO, ATENCION, INFO): el emoji de la primera linea ya indica el nivel.
4. Si el nivel es ATENCION o CRITICO, cerra con una linea que empiece con 👉 y una accion concreta para una persona (revisar, llamar, controlar). Nunca digas que el sistema rechaza o aprueba: decide una persona.
5. Texto plano para Telegram, sin Markdown ni asteriscos. Terminá siempre el mensaje completo. Maximo 16 lineas y 800 caracteres. Español rioplatense con tildes, tono profesional y directo.

FORMATO (respetalo; deja una linea en blanco entre bloques y omiti lo que no venga en los datos):
<emoji del nivel: NORMAL ✅, INFO ℹ️, ATENCION ⚠️, CRITICO 🛑> <TIPO> CERRADO · <PATENTE>
N° <nro> · <hora entrada> → <hora salida>

🏭 <proveedor>   (en un EGRESO: 🐔 <avicola>)
🌾 <producto> · humedad <humedad>

⚖️ Bruto <bruto> · Tara <tara>
📦 NETO <neto>   (si hay neto final: → final <neto_final>)
   🚚 <una linea por carga, solo en egresos>

🔎 Para revisar:   (si el nivel es ATENCION o CRITICO; si es INFO: 📝 Observaciones:)
• <alerta>

👉 <sugerencia>

Si no hay alertas, en lugar de ese bloque poné 'Sin observaciones.'. Para un CAMION SIN PESAR la primera linea es '<emoji> CAMIÓN SIN PESAR · <PATENTE>' y despues va directo el bloque de alertas.
```

Mensaje de usuario (generado por código), ejemplo:

```text
Redacta el aviso para este evento de la balanza. Datos (JSON):
{ "evento": "PESADA_CERRADA", "nivel": "ATENCION", "datos": { "patente": "ZZ103DA", ... },
  "cifras_texto": { "neto": "20.100 kg", "neto_promedio": "27.475 kg", ... },
  "alertas": ["ATENCION: Neto por debajo de lo habitual: ...",
              "ATENCION: La cámara leyó ZZ111LA a las 10:00 pero la pesada se cargó con ZZ103DA..."] }
```

Versión 4.1 del prompt: se agregó un formato con emojis por bloque (proveedor, producto, pesos, observaciones, sugerencia) y líneas en blanco entre bloques, para que el aviso se lea de un vistazo en el celular. La plantilla fija usa el mismo formato.

Parámetros del modelo: `claude-haiku-5-5` con `max_tokens 2000`. En la primera prueba real, con 800, un aviso llegó cortado: el modelo usa parte del límite antes de escribir. Desde la versión 4.2 el validador también descarta el texto si la respuesta terminó por límite de tokens o si a un aviso de ATENCIÓN o CRÍTICO le falta la sugerencia final (👉). Este modelo no acepta el parámetro `temperature` (la API responde error 400 si se envía), así que no se usa; la estabilidad del texto la dan el prompt de sistema y el validador. En el flujo alternativo con Gemini se usa `temperature 0.3` y `thinkingBudget 0`.

## Registro de pruebas con el modelo real

> Completar al conectar la API key real de Anthropic: pegar 2 o 3 avisos generados (uno NORMAL, uno ATENCION y uno CRITICO) y anotar si alguno fue descartado por el validador y por qué.

| Escenario | ¿Pasó el validador? | Observación |
|---|---|---|
| NORMAL | | |
| HUMEDAD Y DESCUENTOS | | |
| HUMEDAD SOBRE LÍMITE | | |
| NETO, TARA Y PATENTE NO COINCIDEN | | |
| EGRESO A TRES GRANJAS | | |
| CAMIÓN SIN PESAR | | |
