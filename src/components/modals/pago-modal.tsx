import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ImageIcon,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Upload,
  UserPlus,
} from "lucide-react";
import ModalWrapper from "@/components/ui/modal-wrapper";
import { useI18n } from "@/lib/i18n";
import { useCurrency, format } from "@/lib/currency";
import { getFaseActual } from "@/lib/pricing";
import { enlaceWhatsApp } from "@/lib/contacto";
import { guardarPedidoLocal, hoyISO } from "@/lib/pedidos-cliente";
import { leerTokenCuenta, useHayCuenta } from "@/lib/cuentas-cliente";
import { crearPedido } from "@/server/pedidos";
import { miCuenta } from "@/server/cuentas";

const MAX_BYTES = 4 * 1024 * 1024;
const TIPOS = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const QR_CANDIDATOS = ["/qr.png", "/qr.jpg", "/qr.jpeg", "/qr.webp"];

function archivoABase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.onload = () => {
      const resultado = String(lector.result ?? "");
      resolve(resultado.includes(",") ? resultado.slice(resultado.indexOf(",") + 1) : resultado);
    };
    lector.readAsDataURL(archivo);
  });
}

function QrPago({ texto }: { texto: string }) {
  const [indice, setIndice] = useState(0);
  if (indice >= QR_CANDIDATOS.length) {
    return (
      <div className="flex aspect-square w-full max-w-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-background/40 p-4 text-center text-[11px] text-muted-foreground">
        <ImageIcon className="h-8 w-8 opacity-40" aria-hidden />
        {texto}
      </div>
    );
  }
  return (
    <img
      src={QR_CANDIDATOS[indice]}
      alt="QR de pago"
      width={440}
      height={440}
      className="aspect-square w-full max-w-[220px] rounded-2xl border border-border bg-white object-contain p-2"
      onError={() => setIndice((n) => n + 1)}
    />
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  onVerEstado: () => void;
  /** Abre el modal de cuenta: comprar con comprobante pide sesión. */
  onCuenta?: () => void;
};

export default function PagoModal({ open, onClose, onVerEstado, onCuenta }: Props) {
  const t = useI18n();
  // El comprobante y el estado del pedido son cosas de la cuenta: sin sesión
  // no hay dónde vincularlos, así que se ofrece entrar (o comprar por WhatsApp)
  // en vez de dejar cargar un comprobante que después no se puede seguir.
  const hayCuenta = useHayCuenta();
  const [currency] = useCurrency();
  const { precio } = getFaseActual();
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [celular, setCelular] = useState("");
  const [web, setWeb] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  /** Object URL de la imagen elegida, para verla antes de enviarla. */
  const [vista, setVista] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ folio: string; estado: string } | null>(null);

  // Si hay cuenta, el formulario arranca con sus datos y el pedido queda
  // vinculado a ella (el comprador lo ve después en "Mi cuenta").
  useEffect(() => {
    if (!open) return;
    const token = leerTokenCuenta();
    if (!token) return;
    let vivo = true;
    void miCuenta({ data: { token } })
      .then((r) => {
        if (!vivo || !r.ok) return;
        setNombre((n) => n || r.cuenta.nombre);
        setCorreo((c) => c || r.cuenta.correo);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [open]);

  // El object URL se libera solo cuando deja de usarse: si no, cada archivo
  // elegido deja el blob anterior retenido mientras el modal esté abierto.
  useEffect(() => () => {
    if (vista) URL.revokeObjectURL(vista);
  }, [vista]);

  const cerrar = () => {
    if (enviando) return;
    setError(null);
    setListo(null);
    setArchivo(null);
    setVista(null);
    onClose();
  };

  const elegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (!f) {
      setArchivo(null);
      setVista(null);
      return;
    }
    if (!TIPOS.includes(f.type)) {
      setError(t("pagoErrorTipo"));
      e.target.value = "";
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("pagoErrorTamano"));
      e.target.value = "";
      return;
    }
    setArchivo(f);
    // Sólo las imágenes se pueden previsualizar: un PDF mostrado como imagen
    // sería un recuadro roto, así que para esos queda el nombre y el tamaño.
    setVista(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (!archivo) {
      setError(t("pagoErrorArchivo"));
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const comprobante = await archivoABase64(archivo);
      const r = await crearPedido({
        data: { nombre, correo, celular, comprobante, web, sesionCuenta: leerTokenCuenta() ?? "" },
      });
      if (!r.ok) {
        const motivos: Record<string, string> = {
          datos: t("pagoErrorDatos"),
          archivo: t("pagoErrorTipo"),
          limite: t("pagoErrorLimite"),
          servidor: t("pagoErrorServidor"),
        };
        setError(motivos[r.motivo] ?? t("pagoErrorServidor"));
        return;
      }
      guardarPedidoLocal({ folio: r.folio, token: r.token, creado: hoyISO() });
      setListo({ folio: r.folio, estado: r.pedido.estado });
      setNombre("");
      setCorreo("");
      setCelular("");
      setWeb("");
      setArchivo(null);
      setVista(null);
    } catch {
      setError(t("pagoErrorServidor"));
    } finally {
      setEnviando(false);
    }
  };

  const input =
    "min-h-11 w-full rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <ModalWrapper
      open={open}
      onClose={cerrar}
      title={listo ? t("pagoListoTitulo") : t("pagoTitulo")}
      subtitle={listo ? t("pagoListoDesc") : t("pagoDesc")}
      icon={<ShieldCheck className="h-5 w-5 text-primary" />}
      ancho="amplio"
    >
      {!hayCuenta ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
            <p className="text-sm font-semibold text-foreground">{t("pagoSesionTitulo")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("pagoSesionTexto")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onCuenta?.();
            }}
            className="boton-spray min-h-11 w-full justify-center gap-2 text-sm"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {t("pagoSesionBoton")}
          </button>
          <a
            href={enlaceWhatsApp(t("plansWaText"))}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background/60 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            {t("plansWhatsAppLabel")}
          </a>
        </div>
      ) : listo ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden />
            <p className="mt-2 text-xs text-muted-foreground">{t("pagoFolio")}</p>
            <p className="font-mono text-xl font-bold tracking-wide text-foreground">{listo.folio}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3 text-primary" aria-hidden />
              {t("pagoEstado_pendiente")}
            </p>
          </div>
          <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {t("pagoListoNota")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={onVerEstado} className="boton-fantasma min-h-11 justify-center text-sm">
              {t("pagoVerEstado")}
            </button>
            <a
              href={enlaceWhatsApp(`${t("plansWaText")} ${listo.folio}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="boton-spray min-h-11 justify-center gap-2 text-sm"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              {t("pagoAvisar")}
            </a>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_230px]">
          <form onSubmit={enviar} className="space-y-3">
            <div>
              <label htmlFor="pago-nombre" className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {t("pagoNombre")}
              </label>
              <input
                id="pago-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                maxLength={60}
                autoComplete="name"
                placeholder={t("pagoNombrePlaceholder")}
                className={input}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="pago-correo" className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {t("pagoCorreo")}
                </label>
                <input
                  id="pago-correo"
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  maxLength={120}
                  autoComplete="email"
                  required
                  placeholder="tu@correo.com"
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="pago-celular" className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {t("pagoCelular")}
                </label>
                <input
                  id="pago-celular"
                  type="tel"
                  value={celular}
                  onChange={(e) => setCelular(e.target.value)}
                  maxLength={30}
                  autoComplete="tel"
                  required
                  placeholder="+591 70000000"
                  className={input}
                />
              </div>
            </div>

            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={web}
              onChange={(e) => setWeb(e.target.value)}
              className="pointer-events-none absolute h-0 w-0 opacity-0"
            />

            <div>
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{t("pagoComprobante")}</span>
              <label
                htmlFor="pago-archivo"
                className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-background/40 px-3 py-4 text-center transition-colors hover:border-primary/60"
              >
                <Upload className="h-5 w-5 text-primary" aria-hidden />
                <span className="text-xs text-muted-foreground">
                  {archivo ? archivo.name : t("pagoSubir")}
                </span>
                <span className="text-[10px] text-muted-foreground">{t("pagoFormatos")}</span>
                <input
                  id="pago-archivo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={elegir}
                  className="sr-only"
                />
              </label>

              {/* Lo que va a enviar, a la vista: evita subir la foto equivocada
                  y tener que esperar a que el equipo la revise para notarlo. */}
              {archivo && (
                <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-background/40">
                  {vista ? (
                    <img
                      src={vista}
                      alt={t("pagoVistaPrevia")}
                      className="max-h-60 w-full bg-white object-contain"
                    />
                  ) : null}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                    <span className="truncate">{archivo.name}</span>
                    <span className="shrink-0">{Math.max(1, Math.round(archivo.size / 1024))} KB</span>
                    <button
                      type="button"
                      onClick={() => {
                        setArchivo(null);
                        setVista(null);
                      }}
                      className="ml-auto shrink-0 font-semibold text-primary hover:underline"
                    >
                      {t("pagoQuitar")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={enviando || !correo.trim() || !celular.trim()}
              className="boton-spray min-h-11 w-full justify-center gap-2 text-sm disabled:opacity-40"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
              {enviando ? t("pagoEnviando") : t("pagoEnviar")}
            </button>
            <button
              type="button"
              onClick={onVerEstado}
              className="w-full text-center text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("pagoYaPedi")}
            </button>
          </form>

          <aside className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card/60 p-3 text-center">
            <p className="texto-tag text-2xl leading-none text-primary">{format(precio, currency)}</p>
            <p className="text-[11px] text-muted-foreground">{t("pagoPrecioUnico")}</p>
            <QrPago texto={t("pagoQrFalta")} />
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t("pagoQrAyuda")}</p>
            <a
              href={enlaceWhatsApp(t("plansWaText"))}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-primary underline-offset-4 hover:underline"
            >
              {t("pagoDuda")}
            </a>
          </aside>
        </div>
      )}
    </ModalWrapper>
  );
}
