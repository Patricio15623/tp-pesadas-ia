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
   - **Name:** `x-api-key`
   - **Value:** la API key

   El encabezado `anthropic-version` ya viene configurado en el nodo.
3. El modelo es `claude-haiku-5-5` y figura en el nodo **Reglas y control de acceso** (`MODELO_IA`). Si en el futuro cambia, se reemplaza solo ese nombre.

**Costo:** cada aviso usa unos pocos cientos de tokens, así que cuesta fracciones de centavo de dólar. El consumo real se ve en la consola de Anthropic.

**Alternativa sin costo:** importar `flujo_aviso_pesada_gemini.json` y crear la credencial con **Name** `x-goog-api-key` y **Value** = API key de <https://aistudio.google.com/apikey>.

## 3. Bot de Telegram

1. En Telegram, hablarle a **@BotFather** → `/newbot` → copiar el **token**.
2. Crear un grupo, por ejemplo "Avisos Balanza (demo)", y agregar el bot.
3. Mandar un mensaje cualquiera en el grupo y abrir `https://api.telegram.org/bot<TOKEN>/getUpdates`. El `chat.id` del grupo es un número negativo.
4. En el nodo **Enviar a Telegram**:
   - **Credential:** Create new → pegar el token.
   - **Chat ID:** reemplazar `CAMBIAR_POR_CHAT_ID` por el número del paso 3.

## 4. Clave de acceso

En el nodo **Reglas y control de acceso**, reemplazar:

```js
const CLAVE_ESPERADA = "CAMBIAR_ESTA_CLAVE";
```

por una clave propia. Esa misma clave se carga en el simulador o en el `.env`. **No se sube al repositorio:** se informa por separado a quien evalúa.

Mientras la clave no se cambie, el flujo rechaza todos los pedidos. Es intencional: una URL pública sin clave permitiría que cualquiera gaste la cuota de IA o mande mensajes al grupo.

## 5. Activar y obtener la URL

1. Guardar y activar el flujo (interruptor **Active**).
2. En el nodo Webhook, copiar la **Production URL**. Termina en `/webhook/pesada-cerrada`.
3. Pegarla en el simulador (sección **Conexión con n8n**) o en el `.env` (`WEBHOOK_URL`).

## Notas

- **Plan de n8n.cloud:** si vence la prueba gratuita o se agotan las ejecuciones del mes, el webhook deja de responder. El simulador lo detecta y sigue funcionando en modo demo con la plantilla, así que el trabajo se puede evaluar igual.
- **Privacidad:** acá se envían solo datos ficticios. Con datos reales hay que revisar las condiciones del proveedor sobre el uso de los datos. Las API pagas, como la de Anthropic, en general no los usan para entrenar por defecto; el nivel gratuito de Gemini sí puede usarlos.
- **Prueba sin internet:** `python scripts/armar_flujo.py --prueba http://127.0.0.1:9999` genera una variante que usa `scripts/servidor_simulado.py` en lugar de la IA y de Telegram. El servidor simulado responde en el formato de Claude o de Gemini. Con esa variante se probaron todos los caminos del flujo (ver `docs/pruebas.md`).
