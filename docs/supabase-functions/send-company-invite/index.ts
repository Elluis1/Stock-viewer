// Supabase Edge Function: send-company-invite
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const inviteId = body?.invite_id as string | undefined;
    const inviteUrl = body?.invite_url as string | undefined;
    if (!inviteId || !inviteUrl) {
      return json(
        {
          ok: false,
          error: "bad_request",
          message: "invite_id e invite_url son obligatorios",
        },
        400,
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: invite, error: invErr } = await admin
      .from("company_invites")
      .select("id, company_id, email, role, status, expires_at, token")
      .eq("id", inviteId)
      .maybeSingle();

    if (invErr || !invite) {
      return json(
        { ok: false, error: "not_found", message: "Invitación no encontrada" },
        404,
      );
    }
    if (invite.status !== "pending") {
      return json(
        {
          ok: false,
          error: "invalid",
          message: "La invitación no está pendiente",
        },
        400,
      );
    }

    const { data: canManage, error: roleErr } = await admin.rpc(
      "is_owner_or_admin_of_company",
      {
        p_company_id: invite.company_id,
        p_user_id: user.id,
      },
    );
    if (roleErr || !canManage) {
      return json(
        {
          ok: false,
          error: "forbidden",
          message: "Solo owner o admin pueden enviar",
        },
        403,
      );
    }

    const { data: company } = await admin
      .from("companies")
      .select("name")
      .eq("id", invite.company_id)
      .maybeSingle();
    const companyName = company?.name ?? "la empresa";

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const from =
        Deno.env.get("INVITE_FROM_EMAIL") ??
        "Stock Desktop <onboarding@resend.dev>";
      const html = `
        <p>Hola,</p>
        <p>Te invitaron a unirte al equipo de <strong>${escapeHtml(companyName)}</strong> en Stock Desktop (rol: ${escapeHtml(invite.role)}).</p>
        <p>Si <strong>no tenés cuenta</strong>, abrí el link, tocá <em>Registrarse</em> con <strong>${escapeHtml(invite.email)}</strong> y después aceptá la invitación.</p>
        <p>Si ya tenés cuenta, iniciá sesión con ese email y aceptá.</p>
        <p><a href="${escapeHtml(inviteUrl)}">Aceptar invitación</a></p>
        <p style="color:#64748b;font-size:12px">El link vence el ${escapeHtml(String(invite.expires_at))}.</p>
      `;

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [invite.email],
          subject: `Te invitaron a ${companyName} en Stock Desktop`,
          html,
        }),
      });

      if (!resendRes.ok) {
        const detail = await resendRes.text();
        return json(
          { ok: false, error: "resend_failed", message: detail },
          502,
        );
      }
      return json({ ok: true, method: "resend" });
    }

    // 1) Usuario nuevo: invite de Auth (mail de "invitación a la app")
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      invite.email,
      { redirectTo: inviteUrl },
    );

    if (!inviteErr) {
      return json({ ok: true, method: "supabase_auth_invite" });
    }

    const msg = (inviteErr.message || "").toLowerCase();
    const alreadyExists =
      msg.includes("already") ||
      msg.includes("registered") ||
      msg.includes("exists");

    if (!alreadyExists) {
      return json({
        ok: false,
        error: "auth_invite_failed",
        message: inviteErr.message,
      });
    }

    // 2) Usuario ya registrado: magic link que redirige a la página de aceptar invite
    const mailer = createClient(supabaseUrl, anonKey);
    const { error: otpErr } = await mailer.auth.signInWithOtp({
      email: invite.email,
      options: {
        emailRedirectTo: inviteUrl,
        shouldCreateUser: false,
      },
    });

    if (otpErr) {
      return json({
        ok: false,
        error: "otp_failed",
        message:
          otpErr.message ||
          "No se pudo enviar el mail. Copiá el link o abrí tu correo.",
      });
    }

    return json({
      ok: true,
      method: "supabase_magic_link",
      message:
        "Se envió un enlace de acceso al correo. Al abrirlo llega a la página de la invitación.",
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", message: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
