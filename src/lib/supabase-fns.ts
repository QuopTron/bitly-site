import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const fetchAppData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { data: appInfo } = await supabaseAdmin
      .from("app_info")
      .select("*")
      .limit(1)
      .maybeSingle();

    const { data: statsData } = await supabaseAdmin
      .from("download_stats")
      .select("platform,count");

    return { appInfo, statsData };
  }
);

export const incrementDownload = createServerFn({ method: "POST" })
  .validator((data: { platform: string }) => data)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.rpc("increment_download", {
      _platform: data.platform,
    });
    if (error) throw error;
    return { ok: true };
  });

export const insertPreReserva = createServerFn({ method: "POST" })
  .validator(
    (data: {
      celular: string;
      opcion_elegida: string;
      precio_original: number;
      precio_descuento: number;
      descuento_porcentaje: number;
    }) => data
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("pre_reservas")
      .insert([data]);
    if (error) throw error;
    return { ok: true };
  });
