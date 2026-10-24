# Formato del evento

El webhook de n8n recibe un JSON por evento. La **operación** usa los mismos nombres de campo que el sistema de pesadas real, así que el día que se conecte, el sistema puede enviar su operación cerrada agregando solo los campos de contexto.

## Evento `PESADA_CERRADA`

```jsonc
{
  "evento": "PESADA_CERRADA",
  "origen": "SIMULADOR",
  "planta": "PLANTA DEMO DE ALIMENTO BALANCEADO",
  "clave": "…",                       // control de acceso (no sigue viajando dentro del flujo)

  // ── Operación (formato del sistema real) ──
  "nro": 1062, "tipo": "INGRESO",     // INGRESO | EGRESO
  "estado": "CERRADA", "fecha": "2026-10-21",
  "hora_entrada": "10:02", "hora_salida": "10:42",
  "patente": "ZZ103DA", "acoplado": "ZZ503DB", "chofer": "CHOFER 04", "transporte": "LOGISTICA EJEMPLO",
  "proveedor": "AGRO PAMPA FICTICIA", "avicola": "",
  "producto_cod": "", "producto_nom": "EXPELLER DE SOJA",
  "humedad": 12.9, "aplica_merma": false,
  "desc_otros": 0, "desc_olor": 0, "desc_amoh": 0, "desc_cham": 0, "desc_bich": 0, "desc_vola": 0,
  "peso_inicial": 37300,              // INGRESO: bruto (entra lleno) · EGRESO: tara (entra vacío)
  "peso_final": 17200,                // INGRESO: tara · EGRESO: bruto
  "neto_total": 20100,                // suma de las cargas
  "cargas": [                         // INGRESO: una · EGRESO: una por granja (el peso se acumula)
    { "orden": 1, "granja": "", "producto_cod": "", "producto_nom": "EXPELLER DE SOJA",
      "peso_balanza": 17200, "neto": 20100, "hora": "10:42" }
  ],
  "operario": "OPERADOR DEMO",

  // ── Contexto que en el sistema real aporta la API ──
  "parametros": [ { "producto": "EXPELLER", "orden": 1, "humedad_base": 13.5, "limite_rechazo": null }, … ],
  "contexto": { "neto_promedio": 27475, "pesadas_previas": 15, "tara_habitual": 16325, "taras_previas": 12 },
  "lecturas_camara": [                // pasos de la cámara de ENTRADA entre 15 min antes y 10 min después
    { "hora": "10:00:30", "patente": "ZZ111LA", "camara": "ENTRADA → SALIDA", "confianza": 95 }
  ]
}
```

## Evento `CAMION_SIN_PESAR`

```json
{ "evento": "CAMION_SIN_PESAR", "origen": "SIMULADOR", "planta": "…", "clave": "…",
  "patente": "ZZ110KA", "hora": "07:20:05", "camara": "ENTRADA → SALIDA" }
```

## Respuesta del flujo

```json
{ "ok": true, "mensaje": "…texto enviado a Telegram…", "origen": "IA (CLAUDE)",
  "motivo_respaldo": "", "texto_ia_descartado": null, "nivel": "ATENCION",
  "alertas": [ { "codigo": "PATENTE_NO_COINCIDE", "severidad": "ATENCION", "texto": "…" } ],
  "cifras": { … }, "telegram_enviado": true, "telegram_error": null }
```

Si la clave no coincide, responde HTTP 401 con `{ "ok": false, "error": "Clave incorrecta." }` y no llama a la IA.

## Alertas posibles

| Código | Nivel | Cuándo |
|---|---|---|
| `PESO_INCOHERENTE` | CRÍTICO | Tara igual o mayor que el bruto |
| `HUMEDAD_SOBRE_LIMITE` | CRÍTICO | Humedad mayor al límite de recepción del producto (si la planta lo cargó; vacío = sin aviso) |
| `DATOS_INCOMPLETOS` | ATENCIÓN | Falta patente, pesos, proveedor o avícola, producto, o la granja de una carga |
| `CARGAS_NO_CIERRAN` | ATENCIÓN | La suma de las cargas difiere más de 20 kg de bruto − tara |
| `NETO_DESVIO` | ATENCIÓN | Neto más de 15 % por encima o por debajo del promedio del proveedor o la avícola (mínimo 3 pesadas previas) |
| `TARA_DESVIO` | ATENCIÓN | Tara más de 3 % distinta de la habitual del camión |
| `PERMANENCIA_LARGA` | ATENCIÓN | Más de 2 h en planta |
| `HORARIO_INCOHERENTE` | ATENCIÓN | Salida anterior a la entrada |
| `PATENTE_NO_COINCIDE` | ATENCIÓN | La cámara de entrada leyó otra patente en ese horario |
| `CAMION_SIN_PESAR` | ATENCIÓN | Un camión pasó por la cámara y no tiene pesada |
| `MERMA_HUMEDAD` / `MERMA_INFORMATIVA` | INFO | Humedad sobre la base: merma aplicada o solo informada (por defecto, informativa) |
| `DESCUENTO_CALIDAD` | INFO | Descuentos: otros % + olor, amohosado, chamico, bichos, volátil |
| `LECTURA_DUDOSA` | INFO | La cámara leyó una patente que difiere en un carácter (por ejemplo, 0 por O) |
| `SIN_PATENTE_LEGIBLE` / `SIN_LECTURA_CAMARA` | INFO | La cámara vio un vehículo sin leer la patente, o no registró el ingreso |
| `FUERA_DE_HORARIO` | INFO | Cierre antes de las 06:00 o después de las 20:00 |

Los umbrales están en `simulador/reglas.js` (`UMBRALES` y `ANPR`).
