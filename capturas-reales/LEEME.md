# Capturas reales

Acá van las capturas de verdad (tu celular, tu PC, tu TV) para reemplazar las maquetas
que hoy usa la guía de instalación.

## Cómo se hace

```bash
node scripts/capturas/reemplazar.mjs --lista   # muestra qué capturar y con qué nombre
# … copiás los archivos en esta carpeta …
node scripts/capturas/reemplazar.mjs           # convierte y reemplaza
pnpm build                                     # listo para publicar
```

También podés usar los atajos del proyecto: `pnpm capturas:reales` y `pnpm capturas:reales --lista`.

El script reencuadra la imagen, la escala al ancho que usa el sitio, la pasa a WebP y la guarda en
`src/assets/capturas/` con el mismo nombre, así que **no hay que tocar código**. Acepta `.png`,
`.jpg`, `.jpeg` y `.webp`. Si falta un archivo, deja la captura actual y te avisa.

## Qué capturar

| Nombre del archivo | Qué tiene que mostrar | Forma | Ancho máx. |
| --- | --- | --- | --- |
| `celular-1-sitio` | el sitio abierto en el celular, con los botones de descarga a la vista | vertical | 1170 px |
| `celular-2-descargas` | el modal con la lista de APK (tocando «Android») | vertical | 1170 px |
| `celular-3-permisos` | Ajustes › Instalar apps desconocidas, activado para el navegador | vertical | 1170 px |
| `celular-4-playprotect` | el aviso de Play Protect «App no reconocida», con Instalar de todos modos | vertical | 1170 px |
| `celular-5-listo` | Bitly ya instalada (pantalla de inicio o app abierta) | vertical | 1170 px |
| `pc-1-sitio` | el sitio abierto en la PC | horizontal | 2560 px |
| `pc-2-descargas` | el modal de Windows con los archivos `.exe` | horizontal | 2000 px |
| `pc-3-smartscreen` | el aviso de SmartScreen, con «Ejecutar de todas formas» | horizontal | 2000 px |
| `tv-1-downloader` | la pantalla de Downloader en la TV con el código escrito | horizontal | 2560 px |
| `ios-1-compartir` | compartir el `Bitly.ipa` y elegir TrollStore | vertical | 1170 px |
| `ios-2-confiar` | Ajustes › VPN y gestión de dispositivos, con el perfil confiado | vertical | 1170 px |
| `ios-3-inicio` | Bitly en la pantalla de inicio del iPhone | vertical | 1170 px |
| `mac-1-dmg` | la ventana del `.dmg` con Bitly y la carpeta Aplicaciones | horizontal | 2000 px |
| `mac-2-gatekeeper` | el aviso de Gatekeeper con «Abrir igualmente» | horizontal | 2000 px |
| `mac-3-terminal` | la Terminal con el comando de cuarentena | horizontal | 2000 px |

## Consejos

- **No hace falta que coincidan exactamente** con la maqueta: sirve cualquier captura donde se vea
  el paso, aunque sea de otra versión de Android, iOS o Windows.
- Sacá la captura **en el momento justo del paso** (el aviso, la pantalla de ajustes) y sin barras
  de herramientas de escritorio si podés.
- Si tu captura del celular es 1080 × 2340, se usa tal cual: no se agranda, sólo se reduce si supera
  el ancho máximo.
- Los archivos de esta carpeta **no se suben al repo** (están ignorados): lo que se publica es el
  WebP ya convertido. Si querés conservarlos versionados, sacá esas líneas del `.gitignore`.
- Las maquetas actuales siguen guardadas como código en `scripts/capturas/mock/`: si querés volver
  atrás, corré `pnpm capturas` (grupo por grupo, por ejemplo `pnpm capturas celular`) y se regeneran.
