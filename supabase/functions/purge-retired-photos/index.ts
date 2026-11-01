import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = request.headers.get("x-retention-token") || "";
  if (!url || !serviceKey || !token) return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503, headers });
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authorized, error: authError } = await client.rpc("check_photo_retention_token", { p_token: token });
  if (authError || authorized !== true) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  const { data: jobs, error: claimError } = await client.rpc("claim_due_photo_retention", { p_limit: 100 });
  if (claimError) return new Response(JSON.stringify({ error: "Queue unavailable" }), { status: 500, headers });
  let deleted = 0, retried = 0;
  for (let offset = 0; offset < (jobs || []).length; offset += 100) {
    const batch = jobs.slice(offset, offset + 100);
    const paths = batch.filter((job: { bucket_id: string }) => job.bucket_id === "people-photos").map((job: { object_path: string }) => job.object_path);
    if (paths.length !== batch.length) {
      await client.rpc("finish_photo_retention", { p_queue_ids: batch.map((job: { queue_id: number }) => job.queue_id), p_success: false, p_error: "Unexpected bucket" });
      retried += batch.length;
      continue;
    }
    const { error: removeError } = await client.storage.from("people-photos").remove(paths);
    const { error: finishError } = await client.rpc("finish_photo_retention", {
      p_queue_ids: batch.map((job: { queue_id: number }) => job.queue_id),
      p_success: !removeError,
      p_error: removeError ? "Storage removal failed; will retry" : null
    });
    if (finishError || removeError) retried += batch.length;
    else deleted += batch.length;
  }
  return new Response(JSON.stringify({ processed: (jobs || []).length, deleted, retried }), { status: 200, headers });
});