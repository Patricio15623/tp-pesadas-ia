# Pruebas realizadas

## 1. Reglas (automáticas)

`node scripts/test_reglas.js` corre **33 pruebas** sobre los datos ficticios. Todas pasan.

| Grupo | Qué se verifica |
|---|---|
| Formato y modelo de datos | Kilos con separador de miles. Bruto y tara según el tipo (ingreso entra lleno, egreso entra vacío). “EXPELLER DE SOJA” toma el parámetro EXPELLER y no SOJA. El neto del egreso es la suma de las cargas por granja. |
| Calidad | La merma es informativa por defecto y descuenta solo si se aplica. Descuentos “otros %” + conceptos. Humedad sobre el límite cargado → CRÍTICO. Límite vacío → sin aviso. |
| Historial y pesos | Neto y tara fuera de lo habitual. Tara mayor que bruto. Cargas que no cierran con bruto − tara. Carga sin granja. |
| Tiempos | Permanencia larga, salida anterior a la entrada y cierre fuera de horario. |
| Cámaras (reglas de la planta) | La otra cámara dentro de 5 min se unifica. La misma cámara dentro de 20 s es una repetida y se ignora. La misma cámara más tarde es otra pasada (ida y vuelta). Las 13 lecturas del día quedan en 7 pasos. |
| Cámaras frente a la pesada | Patente distinta → ATENCIÓN. Difiere en un carácter → lectura dudosa (INFO). La salida de otro camión no confunde. Vehículo sin patente legible. Sin lectura. Camión que pasó y no se pesó. |
| Validador del texto de la IA | Acepta la plantilla en todos los escenarios y los netos por granja. Rechaza cifras inventadas, texto sin patente, Markdown y texto vacío. |

## 2. Flujo completo en n8n (de punta a punta)

Se instaló n8n localmente (versión 1.123) y se importó la variante de prueba del flujo, que reemplaza la IA y Telegram por `scripts/servidor_simulado.py`. Se probó con el formato de respuesta de Claude, el vigente, y antes con el de Gemini, la alternativa. Se verificó que el pedido lleva el modelo `claude-haiku-5-5` y el encabezado `anthropic-version`. Los eventos se enviaron con `scripts/simular_cierre.py`.

| Caso | Resultado obtenido |
|---|---|
| Los 6 camiones en planta | NORMAL, INFO, CRÍTICO, ATENCIÓN, NORMAL y ATENCIÓN. Igual que el simulador web |
| Camión sin pesar (`--sin-pesar`) | ATENCIÓN; aviso redactado y enviado |
| La IA agrega “3.210 kg” | Descartado: *Cifra no calculada por el sistema*. Se envió la plantilla |
| La IA omite la patente | Descartado: *No menciona la patente*. Se envió la plantilla |
| La IA responde error 500 | Se envió la plantilla con el motivo |
| Telegram responde error | El aviso se generó y se informó como NO enviado |
| Clave incorrecta | HTTP 401, sin llamar a la IA |

## 3. Simulador web

Se probó con un navegador automatizado (Chromium), con 36 verificaciones y sin errores en la consola:

- **Modo demo (archivo abierto directo):**
  - **Primera vez:** aparece la ayuda de tres pasos y su botón lleva directo a EN PLANTA.
  - **Ingreso nuevo completo:** se cargaron patente, proveedor, avícola, producto y humedad. Con la balanza simulada el bruto se completó solo al quedar estable la lectura, y la cabecera mostró el peso como en la planta. Después se registró la tara en EN PLANTA (neto 25.000 kg) y se tocó **CERRAR Y EMITIR**. Salió el aviso con la merma estimada y los descuentos.
  - **Egreso nuevo con dos granjas:** netos por carga correctos y total de 23.000 kg.
  - **Los 6 casos de ejemplo:** dieron NORMAL, INFO, CRÍTICO, ATENCIÓN, NORMAL y ATENCIÓN, igual que las pruebas automáticas.
  - **Rechazo, anulación, comprobante y corrección:** el rechazo pide motivo y aparece en el tablero. El comprobante sale con original y duplicado y oculta el resto de la pantalla para imprimir. La corrección queda en los logs.
  - **Camión sin pesar:** los dos camiones que pasaron por la cámara sin pesada aparecen en **SIN PESAR** y se pudieron avisar.
  - **Tablero:** indicadores del día, tabla con totales y detalle desplegable, las seis vistas, control de calidad con vista previa del neto final, cambio de parámetro con motivo y log.
  - En el celular (390 px de ancho) ninguna de las dos pantallas tiene desplazamiento horizontal.
- **Modo conectado:** el link trae la URL y la clave (`?webhook=...&clave=...`) y apunta al n8n local. Pasó el control CORS del navegador y mostró el aviso con "Telegram: Enviado ✓". Con el servidor de IA apagado, n8n respondió con la plantilla y el motivo, y el simulador lo mostró igual.

Capturas en `docs/capturas/`. En `02_prueba_local_ia_simulada.png` el texto lo generó el servidor simulado, no un modelo real: por eso figura "IA (SIMULADA, FORMATO CLAUDE)".

## 4. Prueba con servicios reales (22 y 23/10/2026)

Configuración: n8n.cloud con el flujo publicado, Claude Haiku (`claude-haiku-5-5`) con la API key del autor y el bot de Telegram publicando en el canal público [t.me/s/balanza_avisos_tp](https://t.me/s/balanza_avisos_tp). Los eventos se generaron desde el simulador en modo conectado.

Capturas: `docs/capturas/08_canal_telegram.png` (canal) y `docs/capturas/03_flujo_n8n.png` (ejecución real en n8n.cloud con todos los nodos en verde).

**Resultado:** los avisos llegaron al canal redactados por Claude, con el formato pedido y las cifras exactas. En el caso de ATENCIÓN (ZZ103DA), el modelo ordenó las alertas por importancia (primero la patente) y resumió en una sola sugerencia las tres verificaciones:

```text
⚠️ INGRESO CERRADO · ZZ103DA
N° 1062 · 10:02 → 10:40

🏭 AGRO PAMPA FICTICIA
🌾 EXPELLER DE SOJA · humedad 12.9 %

⚖️ Bruto 37.300 kg · Tara 17.200 kg
📦 NETO 20.100 kg

🔎 Para revisar:
• La cámara leyó ZZ111LA a las 10:00, pero la pesada se cargó con ZZ103DA.
• Neto 7.375 kg por debajo del promedio de 27.475 kg (15 pesadas previas).
• Tara 875 kg mayor que la habitual de este camión (16.325 kg).

👉 Verificar que sea el mismo camión y revisar el acoplado o si quedó carga remanente.
```

**Problemas que aparecieron en la puesta en marcha** (la prueba local no los podía detectar):

| Problema | Síntoma | Solución |
|---|---|---|
| Nombre del encabezado en la credencial | `401 x-api-key header is required` | El campo *Name* de la credencial tiene que ser `x-api-key` |
| El modelo no acepta `temperature` | `400 temperature is deprecated for this model` | Se quitó el parámetro del pedido |
| Identificador de chat mal copiado | Telegram: `chat not found` | Se usaba el `update_id`; el correcto es `chat.id`. Después se pasó a un canal público (`@canal`) |
| Aviso cortado (“👉 Revis”) con `max_tokens` 800 | Llegó incompleto y **pasó el validador** | `max_tokens` 2000 y dos controles nuevos: descartar si la respuesta terminó por límite de tokens o si a un aviso de ATENCIÓN o CRÍTICO le falta la sugerencia (reglas 4.2, con prueba automática) |
| Etiquetas “CRITICO:” e “INFO:” delante de cada alerta | Redundantes con el emoji del nivel | Se ajustó el prompt |

Detalle corregido después (reglas 4.3): en el texto de la IA la humedad salía con punto decimal (12.9) porque recibía el número sin formato; ahora le llega escrita con coma.
