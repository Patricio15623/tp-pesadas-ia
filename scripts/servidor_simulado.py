"""
Servidor SIMULADO de IA y Telegram para probar el flujo de n8n sin conexion a internet
y sin gastar llamadas reales. Lo usa la variante de prueba del flujo:

    python scripts/armar_flujo.py --prueba http://127.0.0.1:9999 n8n/flujo_prueba_local.json
    python scripts/servidor_simulado.py modo.txt

Responde en el formato de Claude (Anthropic) o de Gemini, segun el pedido.
El archivo modo.txt define como responde la "IA":
    ok          -> texto correcto
    inventa     -> agrega una cifra que el sistema no calculo (debe descartarse)
    sinpatente  -> omite la patente (debe descartarse)
    error       -> la IA responde error 500 (debe usarse la plantilla)
    tgfalla     -> Telegram responde error (el aviso se informa como NO enviado)
"""
import json, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
MODO_F = sys.argv[1]
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])) or b'{}')
        modo=open(MODO_F).read().strip()
        if self.path=='/ia':
            anthropic='messages' in body
            prompt=body['messages'][0]['content'] if anthropic else body['contents'][0]['parts'][0]['text']
            datos=json.loads(prompt.split('\n',1)[1])
            c=datos['cifras_texto']; d=datos['datos']
            if modo=='error':
                self.send_response(500); self.end_headers(); self.wfile.write(b'{"error":{"message":"modelo no disponible"}}'); return
            txt=f"⚠️ {d['tipo']} · {d['patente']}" + (f"\nNeto {c['neto']}" if 'neto' in c else "")
            if modo=='inventa': txt+="\nAhorro estimado 3.210 kg"
            if modo=='sinpatente': txt="Pesada cerrada. Neto " + c.get('neto', '')
            resp=({"content":[{"type":"text","text":txt}],"stop_reason":"end_turn"} if anthropic
                  else {"candidates":[{"content":{"parts":[{"text":txt}]}}]})
            open(MODO_F+'.ia_req.json','w').write(json.dumps(body,ensure_ascii=False,indent=1))
        else:
            open(MODO_F+'.tg.json','w').write(json.dumps(body,ensure_ascii=False))
            if modo=='tgfalla':
                self.send_response(500); self.end_headers(); self.wfile.write(b'{"ok":false}'); return
            resp={"ok":True,"result":{"message_id":7}}
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
        self.wfile.write(json.dumps(resp).encode())
HTTPServer(('127.0.0.1',9999),H).serve_forever()
