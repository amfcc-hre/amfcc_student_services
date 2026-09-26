import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type RecipientGroup = "administrator" | "management" | "student_leadership" | "student";
type OutboxItem = {
  id: string;
  recipient_email: string;
  recipient_group: RecipientGroup;
  subject: string;
  payload: Record<string, unknown>;
  attempts: number;
};

const operationsUrl = "https://amfcc-hre.github.io/department-operations/";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanSubject(value: unknown) {
  return String(value ?? "AMFCC Gate Pass Update").replace(/[\r\n]+/g, " " ).slice(0, 200);
}

function eventType(payload: Record<string, unknown>) {
  return String(payload.event_type || "updated").toLowerCase();
}

function requiresApproval(item: OutboxItem) {
  return ["administrator", "management"].includes(item.recipient_group)
    && ["submitted", "pending"].includes(eventType(item.payload || {}));
}

function shouldDeliver(item: OutboxItem) {
  const event = eventType(item.payload || {});
  if (["departed", "returned"].includes(event)) return false;
  if (["administrator", "management"].includes(item.recipient_group)) {
    return ["submitted", "pending"].includes(event);
  }
  if (item.recipient_group === "student_leadership") {
    return ["approved", "rejected", "cancelled", "expired"].includes(event);
  }
  return ["submitted", "approved", "rejected", "cancelled", "expired"].includes(event);
}

function studentHeadline(payload: Record<string, unknown>) {
  switch (eventType(payload)) {
    case "submitted": return "Your pass has been submitted";
    case "pending": return "Your pass is awaiting review";
    case "approved": return "Your pass has been approved";
    case "rejected": return "Your pass has been rejected";
    case "cancelled": return "Your pass has been cancelled";
    case "departed": return "Your departure has been recorded";
    case "returned": return "Your return has been recorded";
    case "expired": return "Your pass is overdue or has expired";
    default: return "Your pass has been updated";
  }
}

function emailSubject(item: OutboxItem) {
  const payload = item.payload || {};
  const student = String(payload.student_name || "Student");
  const label = String(payload.event_label || "Updated");
  if (item.recipient_group === "student") return studentHeadline(payload);
  if (requiresApproval(item)) return `Action required: Gate pass for ${student}`;
  if (item.recipient_group === "administrator") return `School Administration gate pass ${label}: ${student}`;
  if (item.recipient_group === "management") return `Management gate pass ${label}: ${student}`;
  return `Gate pass update: ${student} - ${label}`;
}

function accessFor(group: RecipientGroup) {
  if (group === "administrator") return "administrator";
  if (group === "management") return "management";
  return "student_leadership";
}

function passLink(item: OutboxItem, action: "view" | "approved" | "rejected") {
  const passId = String(item.payload?.pass_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(passId)) return "";
  const url = new URL(operationsUrl);
  url.searchParams.set("pass", passId);
  url.searchParams.set("pass_action", action);
  url.searchParams.set("access", accessFor(item.recipient_group));
  return url.toString();
}

function actionButton(label: string, url: string, background: string, color = "#ffffff") {
  if (!url) return "";
  return `<td style="padding:0 8px 8px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 17px;border-radius:10px;background:${background};color:${color};font-weight:700;text-decoration:none">${escapeHtml(label)}</a></td>`;
}

function actionButtons(item: OutboxItem) {
  if (item.recipient_group === "student") return "";
  let actions = actionButton("View pass", passLink(item, "view"), "#24584b");
  if (requiresApproval(item)) {
    actions += actionButton("Approve", passLink(item, "approved"), "#167047");
    actions += actionButton("Reject", passLink(item, "rejected"), "#a43a34");
  }
  return `<table role="presentation" style="border-collapse:collapse;margin:20px 0 10px"><tr>${actions}</tr></table>
      <p style="margin:0 0 18px;color:#63726c;font-size:12px">You will be asked for the correct workspace PIN before protected details or decision controls are shown. Management must choose Principal, Dean or Director when recording a decision.</p>`;
}

function formatDate(value: unknown) {
  if (!value) return "Not recorded";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-ZW", {
    timeZone: "Africa/Harare",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function plainText(item: OutboxItem) {
  const p = item.payload || {};
  const people = Array.isArray(p.people) ? p.people as Array<Record<string, unknown>> : [];
  const peopleText = people.length
    ? people.map((person) => `${String(person.name || "")} (${String(person.registration_number || "")})`).join(", " )
    : `${String(p.student_name || "Student")} (${String(p.registration_number || "")})`;
  const intro = item.recipient_group === "student"
    ? `${studentHeadline(p)}.`
    : requiresApproval(item)
    ? `${item.recipient_group === "management" ? "Management" : "School Administration"} approval is required.`
    : `Gate pass update: ${String(p.event_label || "Updated")}.`;
  const links = item.recipient_group === "student" ? [] : [
    `View: ${passLink(item, "view")}`,
    ...(requiresApproval(item) ? [
      `Approve: ${passLink(item, "approved")}`,
      `Reject: ${passLink(item, "rejected")}`,
    ] : []),
  ];
  return [
    intro,
    `Student or group: ${peopleText}`,
    `Destination: ${String(p.destination || "Not recorded")}`,
    `Reason: ${String(p.reason || "Not recorded")}`,
    `Departure: ${formatDate(p.departure_at)}`,
    `Expected return: ${formatDate(p.expected_return_at)}`,
    `Contact: ${String(p.contact_details || "Not recorded")}`,
    ...links,
    `Pass reference: ${String(p.pass_id || "")}`,
  ].join("\n");
}

function buildEmail(item: OutboxItem) {
  const p = item.payload || {};
  const isStudent = item.recipient_group === "student";
  const people = Array.isArray(p.people) ? p.people as Array<Record<string, unknown>> : [];
  const peopleText = people.length
    ? people.map((person) => `${escapeHtml(person.name)} (${escapeHtml(person.registration_number)})`).join(", " )
    : `${escapeHtml(p.student_name)} (${escapeHtml(p.registration_number)})`;
  const heading = isStudent
    ? escapeHtml(studentHeadline(p))
    : requiresApproval(item)
    ? "A gate pass needs your review"
    : `Gate pass ${escapeHtml(p.event_label || "update")}`;
  const intro = isStudent
    ? `Hello <strong>${escapeHtml(p.student_name || "Student")}</strong>. ${escapeHtml(studentHeadline(p))}. The details are below.`
    : item.recipient_group === "administrator"
    ? `School Administration approval notification for <strong>${escapeHtml(p.student_name || "Student")}</strong>. Review the pass before recording the separate Administrator decision.`
    : item.recipient_group === "management"
    ? `Management approval notification for <strong>${escapeHtml(p.student_name || "Student")}</strong>. Sign in to review the pass, then record the decision as Principal, Dean or Director.`
    : `Student Leadership notification for <strong>${escapeHtml(p.student_name || "Student")}</strong>. This message provides view-only access after sign-in.`;
  const cancellation = p.cancellation_reason
    ? `<tr><th style="padding:8px;text-align:left;background:#f5f2e8">Cancellation note</th><td style="padding:8px">${escapeHtml(p.cancellation_reason)}</td></tr>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;background:#f5f2e8;font-family:Arial,sans-serif;color:#17231f">
  <div style="max-width:680px;margin:0 auto;padding:24px">
    <div style="background:#123b32;color:#fff;padding:18px 22px;border-radius:16px 16px 0 0">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">AMFCC Student Services</div>
      <h1 style="font-size:24px;margin:7px 0 0">${heading}</h1>
    </div>
    <div style="background:#fff;padding:22px;border:1px solid #d9dfda;border-top:0;border-radius:0 0 16px 16px">
      <p style="line-height:1.55">${intro}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><th style="padding:8px;text-align:left;background:#f5f2e8;width:34%">Student or group</th><td style="padding:8px">${peopleText}</td></tr>
        <tr><th style="padding:8px;text-align:left;background:#f5f2e8">Destination</th><td style="padding:8px">${escapeHtml(p.destination)}</td></tr>
        <tr><th style="padding:8px;text-align:left;background:#f5f2e8">Reason</th><td style="padding:8px">${escapeHtml(p.reason)}</td></tr>
        <tr><th style="padding:8px;text-align:left;background:#f5f2e8">Departure</th><td style="padding:8px">${escapeHtml(formatDate(p.departure_at))}</td></tr>
        <tr><th style="padding:8px;text-align:left;background:#f5f2e8">Expected return</th><td style="padding:8px">${escapeHtml(formatDate(p.expected_return_at))}</td></tr>
        <tr><th style="padding:8px;text-align:left;background:#f5f2e8">Contact</th><td style="padding:8px">${escapeHtml(p.contact_details)}</td></tr>
        ${cancellation}
      </table>
      ${actionButtons(item)}
      <p style="margin:18px 0 0;color:#63726c;font-size:13px">Pass reference: ${escapeHtml(p.pass_id)}</p>
      <p style="color:#63726c;font-size:13px">This is an automatic message from AMFCC IT. Please do not reply with passwords or confidential information.</p>
    </div>
  </div>
</body></html>`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestBody = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(requestBody.action || "drain");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Supabase server configuration is missing." }, 500);

  if (action === "health") {
    if (!resendApiKey) return json({ status:"success",ready:false,resend_key_configured:false,sender:"it@amfcc.ac.zw",sender_domain:"amfcc.ac.zw",domain_status:"not_checked",message:"Add the RESEND_API_KEY Edge Function secret, then check again." });
    try {
      const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${resendApiKey}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return json({ status:"success",ready:true,resend_key_configured:true,sender:"it@amfcc.ac.zw",sender_domain:"amfcc.ac.zw",domain_status:"check_unavailable",message:"The mail key is installed. Confirm that amfcc.ac.zw says Verified in Resend before enabling email." });
      const domains = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
      const domain = domains.find((entry: Record<string, unknown>) => String(entry?.name || "").toLowerCase() === "amfcc.ac.zw");
      const domainStatus = domain ? String(domain.status || "unknown").toLowerCase() : "not_found";
      return json({ status:"success",ready:domainStatus === "verified",resend_key_configured:true,sender:"it@amfcc.ac.zw",sender_domain:"amfcc.ac.zw",domain_status:domainStatus,message:domainStatus === "verified" ? "The mail key and amfcc.ac.zw sender domain are ready." : "The mail key is installed, but amfcc.ac.zw is not verified yet." });
    } catch (_error) {
      return json({ status:"success",ready:true,resend_key_configured:true,sender:"it@amfcc.ac.zw",sender_domain:"amfcc.ac.zw",domain_status:"check_unavailable",message:"The mail key is installed. Confirm that amfcc.ac.zw says Verified in Resend before enabling email." });
    }
  }

  if (!resendApiKey) return json({ error: "Pass email is not ready. Add the RESEND_API_KEY secret first." }, 503);
  const rpc = async (name: string, body: Record<string, unknown>) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json" },
      body: JSON.stringify(body),
    });
    const bodyText = await response.text();
    const value = bodyText ? JSON.parse(bodyText) : null;
    if (!response.ok) throw new Error(value?.message || value?.error || `Database request failed (${response.status}).`);
    return value;
  };

  try {
    const claimed = await rpc("pass_email_claim", { p_limit: 10 });
    const items: OutboxItem[] = Array.isArray(claimed?.items) ? claimed.items : [];
    let sent = 0;
    let failed = 0;
    for (const item of items) {
      try {
        if (!shouldDeliver(item)) {
          await rpc("pass_email_complete", { p_outbox_id:item.id,p_success:true,p_provider_message_id:"suppressed-by-routing",p_error:null });
          continue;
        }
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization:`Bearer ${resendApiKey}`,"Content-Type":"application/json" },
          body: JSON.stringify({ from:"AMFCC IT <it@amfcc.ac.zw>",to:[item.recipient_email],subject:cleanSubject(emailSubject(item)),html:buildEmail(item),text:plainText(item) }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.message || `Mail provider returned ${response.status}.`);
        await rpc("pass_email_complete", { p_outbox_id:item.id,p_success:true,p_provider_message_id:result?.id || null,p_error:null });
        sent += 1;
      } catch (error) {
        await rpc("pass_email_complete", { p_outbox_id:item.id,p_success:false,p_provider_message_id:null,p_error:error instanceof Error ? error.message : "Unknown email delivery error." });
        failed += 1;
      }
    }
    return json({ status:claimed?.status || "success",processed:items.length,sent,failed });
  } catch (error) {
    return json({ error:error instanceof Error ? error.message : "The pass-email worker failed." }, 500);
  }
});
