import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ status: "invalid", message: "POST is required." }, 405);
  try {
    const body = await request.json();
    const action = String(body.action || "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) throw new Error("Document storage is not configured.");
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authorization, error: authorizationError } = await admin.rpc("immigration_document_authorize", {
      p_session_type: body.session_type,
      p_session_token: body.session_token,
      p_action: action,
      p_student_id: body.student_id || null,
      p_document_id: body.document_id || null,
      p_file_name: body.file_name || null,
      p_document_type: body.document_type || null,
      p_mime_type: body.mime_type || null,
      p_file_size: body.file_size || null,
    });
    if (authorizationError) return response({ status: "unauthorized", message: authorizationError.message }, 403);
    if (!authorization || authorization.status !== "success" || !authorization.allowed) {
      return response(authorization || { status: "unauthorized", message: "Document access was denied." }, authorization?.status === "not_found" ? 404 : 403);
    }
    const bucket = authorization.bucket as string;
    const path = authorization.storage_path as string;
    if (action === "prepare_upload") {
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
      if (error) throw error;
      return response({ status: "success", bucket, storage_path: path, document_id: authorization.document_id, upload_token: data.token });
    }
    if (action === "confirm_upload") {
      const { error } = await admin.from("student_immigration_documents").update({ confirmed_at: new Date().toISOString() }).eq("id", authorization.document_id);
      if (error) throw error;
      return response({ status: "success", document_id: authorization.document_id });
    }
    if (action === "signed_url") {
      const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60, { download: authorization.file_name as string });
      if (error) throw error;
      return response({ status: "success", signed_url: data.signedUrl, expires_in: 60 });
    }
    if (action === "delete") {
      const { error: storageError } = await admin.storage.from(bucket).remove([path]);
      if (storageError) throw storageError;
      const { error: rowError } = await admin.from("student_immigration_documents").delete().eq("id", authorization.document_id);
      if (rowError) throw rowError;
      return response({ status: "success", message: "Document deleted." });
    }
    return response({ status: "invalid", message: "Unknown document action." }, 400);
  } catch (error) {
    return response({ status: "error", message: error instanceof Error ? error.message : "Document request failed." }, 500);
  }
});
