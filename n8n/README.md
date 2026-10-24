# Flujo de n8n: configuración paso a paso

Archivo para importar: **`flujo_aviso_pesada.json`** (IA: Claude). La alternativa gratuita con Gemini es `flujo_aviso_pesada_gemini.json`, con los mismos nodos. Se genera con `python scripts/armar_flujo.py` a partir de `simulador/reglas.js`; no hay que editarlo a mano.

```
Webhook ─► Reglas y control de acceso ─► ¿Autorizado? ─sí─► IA redacta el aviso ─► Validar texto de la IA ─► Enviar a Telegram ─► Responder al simulador
                                                     └no─► Responder rechazo (401)
```

| Nodo | Qué hace |
|---|---|
| Webhook pesada cerrada | Recibe el evento (POST `/webhook/pesada-cerrada`): `PESADA_CERRADA` o `CAMION_SIN_PESAR`. El formato está en [`docs/formato_evento.md`](../docs/formato_evento.md). |
| Reglas y control de acceso | Controla la clave, calcula neto, calidad y desvíos, cruza las cámaras de patentes y arma el prompt. |
| ¿Autorizado? | Si la clave no coincide, responde 401 y no llama a la IA (no consume cuota). |
| IA redacta el aviso | Llama a Claude Haiku (API de Anthropic) con el prompt. Si falla, el flujo sigue igual. |
| Validar texto de la IA | Si el texto inventa cifras u omite la patente o el neto, usa la plantilla fija. |
| Enviar a Telegram | Envía el mensaje. Si falla, se informa como "no enviado". |
| Responder al simulador | Devuelve el mensaje, quién lo redactó y si llegó a Telegram. |

## 1. Importar

En n8n: **Workflows → Create → menú ⋯ → Import from file** → elegir `flujo_aviso_pesada.json`.

## 2. API key de Anthropic (IA)

1. En <https://console.anthropic.com>, sección **API Keys**, crear una key. El saldo cargado se ve en **Billing**.
2. En el nodo **IA redacta el aviso** → *Credential for Header Auth* → **Create new**:
   - **Name:** `x-api-key`, exactamente así. Es el nombre del encabezado, no un nombre a elección: si dice otra cosa, Anthropic responde `401 x-api-key header is required`. El título de la credencial, arriba, puede quedar como "Header Auth account".
   - **Value:** la API key, la que empieza con `sk-ant-`.

   El encabezado `anthropic-version` ya viene configurado en el nodo. El pedido no lleva `temperature`, porque este modelo no lo acepta (error 400), y usa `max_tokens` 2000: con 800 un aviso llegó cortado en la prueba real.
3. El modelo es `claude-haiku-5-5` y figura en el nodo **Reglas y control de acceso** (`MODELO_IA`). Si en el futuro cambia, se reemplaza solo ese nombre.

**Costo:** cada aviso usa unos pocos cientos de tokens, así que cuesta fracciones de centavo de dólar. El consumo real se ve en la consola de Anthropic.

**Alternativa sin costo:** importar `flujo_aviso_pesada_gemini.json` y crear la credencial con **Name** `x-goog-api-key` y **Value** = API key de <https://aistudio.google.com/apikey>.

## 3. Bot de Telegram

1. En Telegram, hablarle a **@BotFather** → `/newbot` → copiar el **token** (después se vuelve a ver con `/mybots` → el bot → **API Token**).
2. Elegir a dónde llegan los avisos:
   - **Canal público (lo que se usó en el TP):** crear un canal público, por ejemplo `balanza_avisos_tp`, y agregar el bot como **administrador** con permiso **Publicar mensajes**. El Chat ID es `@balanza_avisos_tp`: con `@` y sin `https://t.me/`. Los avisos se ven sin cuenta en `https://t.me/s/balanza_avisos_tp`.
   - **Chat privado o grupo:** mandarle `/start` al bot (o agregarlo al grupo y escribir algo) y abrir `https://api.telegram.org/bot<TOKEN>/getUpdates`. El Chat ID es el número que sigue a `"chat":{"id":`. **No** es el `update_id`, que es otro número y está al lado. En un grupo el número es negativo.
3. En el nodo **Enviar a Telegram**:
   - **Credential:** Create new → pegar el token **del mismo bot** que está en el canal o el chat.
   - **Chat ID:** reemplazar `CAMBIAR_POR_CHAT_ID` por el del paso 2.

Si Telegram responde `chat not found`, puede ser por tres cosas: el Chat ID está mal, el bot nunca recibió `/start` o el token es de otro bot. El nodo está configurado para que el flujo siga aunque falle, así que el error no se pinta en rojo: se ve en **Executions** → la ejecución → doble clic en **Enviar a Telegram** → *Output*.

## 4. Clave de acceso

En el nodo **Reglas y control de acceso**, reemplazar:

```js
const CLAVE_ESPERADA = "CAMBIAR_ESTA_CLAVE";
```

por una clave propia. Esa misma clave se carga en el simulador o en el `.env`. **No se sube al repositorio:** se informa por separado a quien evalúa.

Mientras la clave no se cambie, el flujo rechaza todos los pedidos. Es intencional: una URL pública sin clave permitiría que cualquiera gaste la cuota de IA o mande mensajes al canal.

## 5. Activar y obtener la URL

1. Guardar y **Publicar** el flujo (botón arriba a la derecha; en versiones anteriores de n8n era el interruptor **Active**). Cada cambio en un nodo requiere volver a publicar. Cambiar solo una credencial no: se aplica sola.
2. En el nodo Webhook, copiar la **Production URL**. Termina en `/webhook/pesada-cerrada`.
3. Pegarla en el simulador (sección **Conexión con n8n**) o en el `.env` (`WEBHOOK_URL`).

## Notas

- **Plan de n8n.cloud:** si vence la prueba gratuita o se agotan las ejecuciones del mes, el webhook deja de responder. El simulador lo detecta y sigue funcionando en modo demo con la plantilla, así que el trabajo se puede evaluar igual.
- **Privacidad:** acá se envían solo datos ficticios. Con datos reales hay que revisar las condiciones del proveedor sobre el uso de los datos. Las API pagas, como la de Anthropic, en general no los usan para entrenar por defecto; el nivel gratuito de Gemini sí puede usarlos.
- **Prueba sin internet:** `python scripts/armar_flujo.py --prueba http://127.0.0.1:9999` genera una variante que usa `scripts/servidor_simulado.py` en lugar de la IA y de Telegram. El servidor simulado responde en el formato de Claude o de Gemini. Con esa variante se probaron todos los caminos del flujo (ver `docs/pruebas.md`).
