import { useState, type ReactNode } from "react";
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import Gallery, { type Captura, type TipoMarco } from "./gallery";

import celular1 from "@/assets/capturas/celular-1-sitio.webp";
import celular2 from "@/assets/capturas/celular-2-descargas.webp";
import celular3 from "@/assets/capturas/celular-3-permisos.webp";
import celular4 from "@/assets/capturas/celular-4-playprotect.webp";
import celular5 from "@/assets/capturas/celular-5-listo.webp";
import pc1 from "@/assets/capturas/pc-1-sitio.webp";
import pc2 from "@/assets/capturas/pc-2-descargas.webp";
import pc3 from "@/assets/capturas/pc-3-smartscreen.webp";
import tv1 from "@/assets/capturas/tv-1-downloader.webp";
import ios1 from "@/assets/capturas/ios-1-compartir.webp";
import ios2 from "@/assets/capturas/ios-2-confiar.webp";
import ios3 from "@/assets/capturas/ios-3-inicio.webp";
import mac1 from "@/assets/capturas/mac-1-dmg.webp";
import mac2 from "@/assets/capturas/mac-2-gatekeeper.webp";
import mac3 from "@/assets/capturas/mac-3-terminal.webp";

export const TROLLSTORE_URL = "https://github.com/opa334/TrollStore";
export const SIDELOADLY_URL = "https://sideloadly.io/";

const SITIO = "bitly-site.pages.dev";

/* ─────────────────────── Piezas compartidas ─────────────────────── */

/** Paso numerado, con la misma estética en el modal y en la sección. */
export function Paso({ num, titulo, children }: { num: number; titulo: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary sm:h-7 sm:w-7 sm:text-xs">
        {num}
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold sm:text-sm md:text-[15px]">{titulo}</p>
        {children && (
          <div className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs md:text-[13px]">{children}</div>
        )}
      </div>
    </li>
  );
}

/** Recuadro de aviso (info / atención / listo). */
export function Aviso({
  tono = "info",
  titulo,
  children,
}: {
  tono?: "info" | "atencion" | "listo";
  titulo: string;
  children?: ReactNode;
}) {
  const estilos = {
    info: { caja: "border-primary/30 bg-primary/5", color: "text-primary" },
    atencion: { caja: "border-amber-500/30 bg-amber-500/5", color: "text-amber-600 dark:text-amber-400" },
    listo: { caja: "border-emerald-500/30 bg-emerald-500/5", color: "text-emerald-600 dark:text-emerald-400" },
  }[tono];
  const Icono = tono === "atencion" ? AlertCircle : tono === "listo" ? CheckCircle2 : Info;

  return (
    <div
      className={`rounded-xl border p-3 text-[11px] leading-relaxed text-muted-foreground sm:text-xs md:text-[13px] ${estilos.caja}`}
    >
      <p className="flex items-start gap-2">
        <Icono className={`mt-[1px] h-3.5 w-3.5 flex-shrink-0 ${estilos.color}`} />
        <span>
          <strong className={estilos.color}>{titulo}:</strong> {children}
        </span>
      </p>
    </div>
  );
}

/** Botón para copiar al portapapeles. */
export function CopiarBoton({ texto, etiqueta }: { texto: string; etiqueta?: string }) {
  const t = useI18n();
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={copiar}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition sm:text-xs ${
        copiado
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border/60 bg-card/40 text-foreground hover:border-primary/40 hover:bg-primary/5"
      }`}
    >
      {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
      {copiado ? t("installCopied") : (etiqueta ?? t("installCopy"))}
    </button>
  );
}

/** Bloque de código monoespaciado con su botón de copiar. */
export function Comando({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 p-2.5">
      <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">{titulo}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:text-[11px]">
          {texto}
        </code>
        <CopiarBoton texto={texto} />
      </div>
    </div>
  );
}

/** Tarjeta de "camino alternativo" (las dos vías de iOS). */
function Via({
  titulo,
  insignia,
  descripcion,
  nota,
  children,
}: {
  titulo: string;
  insignia?: string;
  descripcion: string;
  /** Contenido extra antes de los pasos (por ejemplo, los requisitos). */
  nota?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-foreground">{titulo}</h4>
        {insignia && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
            {insignia}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs md:text-[13px]">{descripcion}</p>
      {nota && <div className="mb-4 mt-3">{nota}</div>}
      <ol className="space-y-3">{children}</ol>
    </div>
  );
}

function Enlace({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline sm:text-xs"
    >
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/* ─────────────────────────── Capturas ─────────────────────────── */

function capturasCelular(t: (k: string) => string): Captura[] {
  // Ancho y alto reales: con eso el navegador reserva el alto antes de que la
  // imagen llegue, así la sección no se estira cuando carga.
  const medidas: Array<[number, number]> = [
    [1170, 2400],
    [1170, 2259],
    [1170, 2532],
    [1170, 2532],
    [1170, 2532],
  ];
  return [1, 2, 3, 4, 5].map((n) => ({
    src: [celular1, celular2, celular3, celular4, celular5][n - 1],
    w: medidas[n - 1][0],
    h: medidas[n - 1][1],
    alt: t(`installPhoneShot${n}`),
    titulo: t(`installPhoneShot${n}`),
    pie: t(`installPhoneShot${n}Desc`),
  }));
}

function capturasPC(t: (k: string) => string): Captura[] {
  const medidas: Array<[number, number]> = [
    [2560, 1494],
    [1120, 1306],
    [1504, 848],
  ];
  return [1, 2, 3].map((n) => ({
    src: [pc1, pc2, pc3][n - 1],
    w: medidas[n - 1][0],
    h: medidas[n - 1][1],
    alt: t(`installPCShot${n}`),
    titulo: t(`installPCShot${n}`),
    pie: t(`installPCShot${n}Desc`),
  }));
}

function capturasIOS(t: (k: string) => string): Captura[] {
  const medidas: Array<[number, number]> = [
    [1170, 2532],
    [1170, 2532],
    [1170, 2532],
  ];
  return [1, 2, 3].map((n) => ({
    src: [ios1, ios2, ios3][n - 1],
    w: medidas[n - 1][0],
    h: medidas[n - 1][1],
    alt: t(`installIOSShot${n}`),
    titulo: t(`installIOSShot${n}`),
    pie: t(`installIOSShot${n}Desc`),
  }));
}

function capturasMac(t: (k: string) => string): Captura[] {
  const medidas: Array<[number, number]> = [
    [1624, 1128],
    [1036, 828],
    [1696, 528],
  ];
  return [1, 2, 3].map((n) => ({
    src: [mac1, mac2, mac3][n - 1],
    w: medidas[n - 1][0],
    h: medidas[n - 1][1],
    alt: t(`installMacShot${n}`),
    titulo: t(`installMacShot${n}`),
    pie: t(`installMacShot${n}Desc`),
  }));
}

/* ─────────────────────────── Guías ─────────────────────────── */

/** Celular (Android): capturas + pasos + el permiso de archivos. */
export function GuiaCelular({ conCapturas = false }: { conCapturas?: boolean }) {
  const t = useI18n();
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm md:text-[15px]">{t("installPhoneIntro")}</p>

      {conCapturas ? (
        <Gallery capturas={capturasCelular(t)} tipo={"telefono" as TipoMarco} url={SITIO} />
      ) : (
        <ol className="space-y-3">
          {[1, 2, 3, 4].map((n) => (
            <Paso key={n} num={n} titulo={t(`installStep${n}Title`)}>
              <p>{t(`installStep${n}Desc`)}</p>
            </Paso>
          ))}
        </ol>
      )}

      <Aviso tono="atencion" titulo={t("installPhoneTipTitle")}>
        {t("installPhoneTipDesc")}
      </Aviso>
    </div>
  );
}

/** PC (Windows): capturas + SmartScreen. */
export function GuiaPC({ conCapturas = false }: { conCapturas?: boolean }) {
  const t = useI18n();
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm md:text-[15px]">{t("installPCIntro")}</p>

      {conCapturas ? (
        <Gallery capturas={capturasPC(t)} tipo={"ventana" as TipoMarco} url={SITIO} />
      ) : (
        <ol className="space-y-3">
          {[1, 2, 3].map((n) => (
            <Paso key={n} num={n} titulo={t(`releaseWinStep${n}Title`)}>
              <p>{t(`releaseWinStep${n}Desc`)}</p>
            </Paso>
          ))}
        </ol>
      )}

      {!conCapturas && (
        <Aviso tono="atencion" titulo={t("installPCShot3")}>
          {t("installPCShot3Desc")}
        </Aviso>
      )}
    </div>
  );
}

/** Smart TV: Downloader + código. Mismo texto en la web y en el modal. */
export function GuiaTV({ conCapturas = false }: { conCapturas?: boolean }) {
  const t = useI18n();
  const codigos = [
    { codigo: "8134206", titulo: t("installTVModern"), lista: t("installTVModernList"), destacado: true },
    { codigo: "3035631", titulo: t("installTVOld"), lista: t("installTVOldList"), destacado: false },
  ];

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm md:text-[15px]">{t("installTVIntro")}</p>

      {conCapturas && (
        <Gallery
          capturas={[
            { src: tv1, w: 3200, h: 1800, alt: t("installTVShot"), titulo: t("installTVShot"), pie: t("installTVShotDesc") },
          ]}
          tipo={"tv" as TipoMarco}
        />
      )}

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("installTVCodeTitle")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {codigos.map((c) => (
            <div
              key={c.codigo}
              className={`rounded-2xl border p-3.5 ${
                c.destacado ? "border-primary/35 bg-primary/[0.07]" : "border-border/60 bg-card/30"
              }`}
            >
              <p className="text-xs font-bold text-primary">{c.titulo}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">{c.lista}</p>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-background/50 px-3 py-2 ring-1 ring-border/50">
                <span className="font-mono text-lg font-bold tracking-[0.16em] text-foreground sm:text-xl md:text-2xl">
                  {c.codigo}
                </span>
                <CopiarBoton texto={c.codigo} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground sm:text-[11px]">{t("installTVCodeIn")}</p>
      </div>

      <ol className="space-y-3">
        {[1, 2, 3, 4].map((n) => (
          <Paso key={n} num={n} titulo={t(`releaseTVStep${n}Title`)}>
            <p>{t(`releaseTVStep${n}Desc`)}</p>
          </Paso>
        ))}
      </ol>

      <Aviso titulo={t("releaseTVGuideNote")}>{t("releaseTVGuideNoteDesc")}</Aviso>
    </div>
  );
}

/** iPhone / iPad: TrollStore (sin PC) o Sideloadly (con PC). */
export function GuiaIOS({ conCapturas = false }: { conCapturas?: boolean }) {
  const t = useI18n();
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm md:text-[15px]">{t("installIOSIntro")}</p>

      <Aviso tono="info" titulo={t("installIOSNoteTitle")}>
        {t("installIOSNoteDesc")}
      </Aviso>

      {conCapturas && <Gallery capturas={capturasIOS(t)} tipo={"telefono" as TipoMarco} />}

      <Via
        titulo={t("installIOSMethodA")}
        insignia={t("installIOSMethodAbadge")}
        descripcion={t("installIOSMethodADesc")}
        nota={
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-[10px] text-muted-foreground">
              {t("installIOSReqTitle")}
            </span>
            {["installIOSReq1", "installIOSReq2", "installIOSReq3"].map((k, i) => (
              <span
                key={k}
                className={`rounded-full px-2.5 py-1 text-[10px] ${
                  i === 2
                    ? "border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                    : "border border-primary/30 bg-primary/5 text-primary"
                }`}
              >
                {t(k)}
              </span>
            ))}
          </div>
        }
      >
        <Paso num={1} titulo={t("releaseIOSStep1Title")}>
          <p>{t("releaseIOSStep1Desc")}</p>
          <Enlace href={TROLLSTORE_URL}>{t("installIOSTrollLink")}</Enlace>
        </Paso>
        <Paso num={2} titulo={t("releaseIOSStep2Title")}>
          <p>{t("releaseIOSStep2Desc")}</p>
        </Paso>
        <Paso num={3} titulo={t("releaseIOSStep3Title")}>
          <p>{t("releaseIOSStep3Desc")}</p>
        </Paso>
      </Via>

      <Via titulo={t("installIOSMethodB")} descripcion={t("installIOSMethodBDesc")}>
        <Paso num={1} titulo={t("installIOSB1Title")}>
          <p>{t("installIOSB1Desc")}</p>
          <Enlace href={SIDELOADLY_URL}>{t("installIOSSidelLink")}</Enlace>
        </Paso>
        <Paso num={2} titulo={t("installIOSB2Title")}>
          <p>{t("installIOSB2Desc")}</p>
        </Paso>
        <Paso num={3} titulo={t("installIOSB3Title")}>
          <p>{t("installIOSB3Desc")}</p>
        </Paso>
        <Paso num={4} titulo={t("installIOSB4Title")}>
          <p>{t("installIOSB4Desc")}</p>
        </Paso>
      </Via>
    </div>
  );
}

/** macOS: el .dmg y la puerta de Gatekeeper. */
export function GuiaMac({ conCapturas = false }: { conCapturas?: boolean }) {
  const t = useI18n();
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm md:text-[15px]">{t("installMacIntro")}</p>

      {conCapturas && <Gallery capturas={capturasMac(t)} tipo={"plano" as TipoMarco} />}

      <ol className="space-y-3">
        {[1, 2, 3].map((n) => (
          <Paso key={n} num={n} titulo={t(`releaseMacStep${n}Title`)}>
            <p>{t(`releaseMacStep${n}Desc`)}</p>
          </Paso>
        ))}
      </ol>

      <Aviso tono="atencion" titulo={t("installMacGateTitle")}>
        {t("installMacGateDesc")}
      </Aviso>

      <Comando titulo={t("installMacTerminal")} texto="xattr -dr com.apple.quarantine /Applications/Bitly.app" />

      <ol className="space-y-3">
        <Paso num={4} titulo={t("releaseMacStep4Title")}>
          <p>{t("releaseMacStep4Desc")}</p>
        </Paso>
      </ol>
    </div>
  );
}
