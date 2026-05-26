import { useState, useEffect } from "react";
import { X, Send, Smartphone, Shield, Clock, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

const PRE_RESERVA_END = new Date("2026-06-01T00:00:00-04:00");

const PLANES = [
  { id: "opcion1", nombreKey: "preReservaPlan1Name", precio_original: 60, precio_descuento: 36, descripcionKey: "preReservaPlan1Desc", featureKeys: ["preReservaBasic1","preReservaBasic2","preReservaBasic3","preReservaBasic4","preReservaBasic5","preReservaBasic6"] },
  { id: "opcion2", nombreKey: "preReservaPlan2Name", precio_original: 80, precio_descuento: 48, descripcionKey: "preReservaPlan2Desc", featureKeys: ["preReservaStd1","preReservaStd2","preReservaStd3","preReservaStd4","preReservaStd5","preReservaStd6","preReservaStd7"] },
  { id: "opcion3", nombreKey: "preReservaPlan3Name", precio_original: 100, precio_descuento: 60, descripcionKey: "preReservaPlan3Desc", featureKeys: ["preReservaPrem1","preReservaPrem2","preReservaPrem3","preReservaPrem4","preReservaPrem5","preReservaPrem6","preReservaPrem7"] },
];

function fmt(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function PrereserveModal({ onClose }: { onClose: () => void }) {
  const t = useI18n();
  const [timer, setTimer] = useState(0);
  const [celular, setCelular] = useState("");
  const [plan, setPlan] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setTimer(Math.max(0, PRE_RESERVA_END.getTime() - Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!celular || celular.length < 8) { setError(t("preReservaCellphoneError")); return; }
    if (!plan) { setError(t("preReservaSelectPlanError")); return; }
    setLoading(true);
    setError(null);
    const p = PLANES.find((x) => x.id === plan);
    if (!p) return;
    try {
      const { error: err } = await supabase.from("pre_reservas").insert([{ celular, opcion_elegida: p.id, precio_original: p.precio_original, precio_descuento: p.precio_descuento, descuento_porcentaje: 50 }]);
      if (err) throw err;
      setSuccess(true);
      setCelular("");
      setPlan("");
    } catch {
      setError(t("preReservaRegisterError"));
    } finally { setLoading(false); }
  };

  if (timer <= 0) { onClose(); return null; }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-card/90 p-3 shadow-2xl shadow-primary/10 animate-in zoom-in-95 duration-300 overflow-hidden sm:p-4">
        <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-primary via-accent to-primary" />
        <button onClick={onClose} className="absolute right-2 top-2 z-20 rounded-full p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground sm:right-3 sm:top-3"><X className="h-4 w-4" /></button>
        <div className="mb-3 text-center relative z-10">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/30 to-primary/10 shadow-lg shadow-primary/20 sm:h-12 sm:w-12">
            <Clock className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
          </div>
          <h2 className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-lg font-bold text-transparent sm:text-xl">{t("preReservaTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("preReservaSubtitle")}</p>
        </div>
        {timer > 0 && (
          <div className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5 px-3 py-2 relative overflow-hidden">
            <Clock className="h-3.5 w-3.5 flex-shrink-0 text-primary sm:h-4 sm:w-4" />
            <span className="font-mono font-semibold text-primary text-xs sm:text-sm">{t("preReservaTimer")} {fmt(timer)}</span>
          </div>
        )}
        {success ? (
          <div className="relative z-10 py-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-green-500/30 bg-green-500/20 shadow-lg shadow-green-500/20 sm:h-16 sm:w-16">
              <Shield className="h-7 w-7 text-green-500 sm:h-8 sm:w-8" />
            </div>
            <h3 className="mb-1 text-lg font-bold text-foreground sm:text-xl">{t("preReservaSuccess")}</h3>
            <p className="text-xs text-muted-foreground sm:text-sm">{t("preReservaSuccessMsg")}</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 sm:px-6 sm:py-2.5 sm:text-sm">{t("preReservaClose")}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
              {PLANES.map((p) => (
                <div key={p.id} onClick={() => setPlan(p.id)} className={`cursor-pointer rounded-xl border-2 p-3 transition-all hover:shadow-lg hover:shadow-primary/20 sm:p-4 ${plan === p.id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border bg-card/50 hover:border-primary/60 hover:bg-card/80"}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground sm:text-sm">{t(p.nombreKey)}</h3>
                    <span className="relative -top-1.5 rounded-full bg-gradient-to-r from-primary to-accent px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-primary-foreground sm:px-2 sm:text-[9px]">40% OFF</span>
                  </div>
                  <p className="mb-0.5 text-[10px] text-muted-foreground line-through opacity-60">{p.precio_original} Bs</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-primary sm:text-xl">{p.precio_descuento}</span>
                    <span className="text-[10px] text-primary/70 sm:text-xs">Bs</span>
                  </div>
                  <p className="mt-1 text-[9px] text-muted-foreground sm:text-[10px]">{t(p.descripcionKey)}</p>
                  <div className="mt-1.5 space-y-0.5">
                    {p.featureKeys.slice(0, 4).map((key, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[9px] text-muted-foreground sm:text-[10px]">
                        <Shield className="h-3 w-3 flex-shrink-0 text-primary/50" />
                        <span className="leading-tight">{t(key)}</span>
                      </div>
                    ))}
                  </div>
                  {plan === p.id && (
                    <div className="mt-3 flex items-center justify-center gap-1.5">
                      <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                      <span className="text-[9px] font-medium text-primary sm:text-[10px]">{t("preReservaIncludes")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border/70 bg-gradient-to-br from-background/80 to-background/60 p-3 backdrop-blur sm:p-4">
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">{t("preReservaCellphone")}</label>
              <div className="relative">
                <Smartphone className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                <input type="tel" value={celular} onChange={(e) => { setCelular(e.target.value.replace(/\D/g, "").slice(0, 8)); if (error) setError(null); }} placeholder="Ej: 71234567" className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-2.5 text-xs font-semibold text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition shadow-sm sm:py-2.5 sm:text-sm" />
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">{t("preReservaCellphoneHelp")}</p>
            </div>
            {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-2.5 text-center sm:p-3"><p className="text-[10px] font-medium text-destructive sm:text-xs">{error}</p></div>}
            <button type="submit" disabled={loading} className="relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-primary to-primary/90 py-2.5 text-xs font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:py-3 sm:text-sm">
              <div className="relative flex items-center justify-center gap-2">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    {t("preReservaConfirming")}
                  </span>
                ) : (
                  <><Send className="h-4 w-4" />{t("preReservaConfirm")}</>
                )}
              </div>
            </button>
            <p className="text-center text-[10px] text-muted-foreground">{t("preReservaTerm")}</p>
          </form>
        )}
      </div>
    </div>
  );
}
