# Capturas de la guía de instalación

Genera las imágenes de `src/assets/capturas/` que usa la sección **«Instalá Bitly, paso a paso»**
(`src/components/install/`). Todas salen de Chrome sin ventana, controlado por DevTools Protocol.

```bash
node scripts/capturas/capturar.mjs                       # todo: celular, pc, tv, ios y mac
node scripts/capturas/capturar.mjs celular pc            # sólo algunos grupos
node scripts/capturas/capturar.mjs revision              # no guarda: mide la sección en 7 anchos
```

## De dónde sale cada captura

| Archivo | Origen |
| --- | --- |
| `celular-1-sitio` | sitio en vivo, recortado a la pantalla del celular |
| `celular-2-descargas` | sitio en vivo, recorte del modal con la lista de APK |
| `celular-3-permisos` | maqueta `mock/android-permisos.html` (Ajustes de Android) |
| `celular-4-playprotect` | maqueta `mock/android-instalar.html` (aviso de Play Protect) |
| `celular-5-listo` | maqueta `mock/android-listo.html` (app instalada) |
| `pc-1-sitio` | sitio en vivo, vista escritorio |
| `pc-2-descargas` | sitio en vivo, recorte del modal con los `.exe` |
| `pc-3-smartscreen` | maqueta `mock/windows-smartscreen.html` |
| `tv-1-downloader` | maqueta `mock/tv-downloader.html` |
| `ios-1-compartir` | maqueta `mock/ios-compartir.html` (compartir el `.ipa` con TrollStore) |
| `ios-2-confiar` | maqueta `mock/ios-confiar.html` (confiar en el perfil de Sideloadly) |
| `ios-3-inicio` | maqueta `mock/ios-inicio.html` (Bitly en la pantalla de inicio) |
| `mac-1-dmg` | maqueta `mock/mac-dmg.html` (arrastrar a Aplicaciones) |
| `mac-2-gatekeeper` | maqueta `mock/mac-gatekeeper.html` (aviso de Gatekeeper) |
| `mac-3-terminal` | maqueta `mock/mac-terminal.html` (comando para quitar la cuarentena) |

Las maquetas de `mock/` son pantallas de sistema (Android, iOS, Windows, macOS, Downloader)
dibujadas en HTML para que se vean igual que en un dispositivo real: no se pueden capturar desde
el navegador, haría falta el aparato de verdad.

Las capturas del celular salen a 3x y las de escritorio a 2x, así se ven nítidas en pantallas de
alta densidad. Ojo con el peso: cada WebP queda entre 30 y 160 KB, y la galería carga sólo la
pestaña activa.

## Reemplazarlas por capturas reales

Las maquetas están bien para explicar el paso, pero con capturas de un dispositivo real se ve mucho
mejor. El flujo es soltar archivos y correr un script:

```bash
pnpm capturas:reales --lista   # qué capturar y con qué nombre
# … copiás las capturas en capturas-reales/ …
pnpm capturas:reales           # convierte a WebP y reemplaza los assets
```

El detalle de cada hueco está en [`capturas-reales/LEEME.md`](../../capturas-reales/LEEME.md). El
script reencuadra, escala y convierte; si falta un archivo o la captura parece de la pantalla
equivocada, lo dice y no toca nada más.

## Variables de entorno

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | binario de Chrome |
| `SITIO_URL` | `https://bitly-site.pages.dev` | sitio a capturar |
| `CAPTURA_CALIDAD` | `92` | calidad del WebP |
| `REVISION_ANCHOS` | `320,390,430,768,1024,1440,1920` | anchos de la revisión |

## Verificación

El script mide los píxeles de cada captura (luminancia media, desvío, tonos) y avisa si alguna
salió casi plana, es decir, si el maquetado se rompió y quedó una imagen en blanco o negro.

La revisión comprueba además que la sección no desborde a lo ancho en ningún ancho, que las 5
pestañas cambien de contenido, que las capturas se decodifiquen y que la vista ampliada abra.
Para eso conviene servir la compilación real con los tipos MIME correctos (en Windows, Python
sirve `.js` como `text/plain` por culpa del registro, y el navegador no ejecuta el módulo):

```bash
pnpm build
python -c "import http.server, socketserver, mimetypes, functools
mimetypes.add_type('text/javascript', '.js')
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory='dist/client')
class S(socketserver.ThreadingTCPServer): allow_reuse_address = True
S(('127.0.0.1', 4322), Handler).serve_forever()"

# en otra terminal: el backend real sólo acepta el origen del sitio publicado,
# así que se simulan sus respuestas para poder medir la sección en local
STUB_SIN_BACKEND=1 SITIO_URL=http://127.0.0.1:4322/ node scripts/capturas/capturar.mjs revision
```
