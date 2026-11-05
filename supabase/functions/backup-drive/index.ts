import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REDIRECT_URI = "https://etvxrzjtnhuefxeirkxf.supabase.co/functions/v1/backup-drive/oauth/callback";
const APP_RETURN = "https://tncykeyra.github.io/cadastro-individuos-app/?drive=connected#";
const ALLOWED_ORIGINS = new Set(["https://tncykeyra.github.io", "http://localhost:5173", "http://127.0.0.1:5173"]);
const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };

function response(body: unknown, status = 200, origin = "") {
  const headers = new Headers(jsonHeaders);
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
  return new Response(JSON.stringify(body), { status, headers });
}
function html(text: string, status = 200) {
  return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadastro Criminal</title><style>body{font:16px system-ui;background:#f4f6f6;color:#202528;display:grid;min-height:90vh;place-items:center;margin:0}.card{background:white;padding:28px;border-radius:18px;max-width:520px;margin:18px;box-shadow:0 8px 30px #0001}a{display:inline-block;background:#50595e;color:white;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700}</style><main class="card"><h1>${text}</h1><p>Você pode fechar esta janela e voltar ao Cadastro Criminal.</p><a href="${APP_RETURN}">Voltar ao aplicativo</a></main></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" } });
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clients() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) throw new Error("server configuration unavailable");
  return {
    admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    anon: createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}
async function requireMaster(request: Request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const { admin, anon } = clients();
  const { data, error } = await anon.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const { data: membership, error: membershipError } = await admin.from("city_memberships").select("user_id").eq("user_id", data.user.id).eq("is_master", true).limit(1).maybeSingle();
  if (membershipError || !membership) return null;
  return { admin, userId: data.user.id };
}
async function googleAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const token = await result.json();
  if (!result.ok || !token.access_token) throw new Error("Não foi possível validar a conexão com o Google Drive.");
  return String(token.access_token);
}
async function driveFetch(url: string, token: string, init: RequestInit = {}) {
  return await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
}
async function userClient(request: Request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const { admin, anon } = clients();
  const token = auth.slice(7);
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return null;
  return { admin, userId: data.user.id, client: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } }) };
}
async function driveCredentials(admin: ReturnType<typeof clients>["admin"]) {
  const [{ data: config }, { data: refreshToken }] = await Promise.all([
    admin.from("drive_storage_config").select("folder_id").eq("id", true).maybeSingle(),
    admin.rpc("drive_get_refresh_token"),
  ]);
  if (!config?.folder_id || typeof refreshToken !== "string") throw new Error("Google Drive não está conectado.");
  return { folderId: String(config.folder_id), accessToken: await googleAccessToken(refreshToken) };
}
async function digest(bytes: Uint8Array) {
  const value = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function uploadDriveFile(accessToken: string, folderId: string, name: string, mime: string, bytes: Uint8Array) {
  const boundary = "cadastro-drive-" + crypto.randomUUID();
  const metadata = JSON.stringify({ name, mimeType: mime, parents: [folderId] });
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
  const response = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size", accessToken, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  const file = await response.json();
  if (!response.ok || !file.id) throw new Error("Falha ao copiar uma foto para o Drive.");
  return String(file.id);
}
async function deleteDriveFile(accessToken: string, fileId: string) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, accessToken, { method: "DELETE" });
}
async function drivePhotoCount(admin: ReturnType<typeof clients>["admin"]) {
  const { count, error } = await admin.from("record_photos").select("id", { count: "exact", head: true }).not("photo_path", "like", "drive:%").not("photo_path", "like", "http%");
  if (error) throw error;
  const { count: migrated, error: migrationError } = await admin.from("drive_photo_migrations").select("source_path", { count: "exact", head: true }).eq("status", "active");
  if (migrationError) throw migrationError;
  const remaining = count || 0;
  return { total: remaining + (migrated || 0), migrated: migrated || 0, remaining };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...jsonHeaders, "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" } });
  const url = new URL(request.url);
  const route = url.pathname.split("/backup-drive/")[1] || "";
  try {
    if (route === "oauth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code") || "", state = url.searchParams.get("state") || "";
      if (!code || !state || state.length < 32) return html("Não foi possível validar a autorização. Volte ao aplicativo e tente novamente.", 400);
      const { admin } = clients();
      const stateHash = await sha256(state);
      const { data: savedState, error: stateError } = await admin.from("drive_oauth_states").select("state_hash,user_id,expires_at").eq("state_hash", stateHash).maybeSingle();
      if (stateError || !savedState || new Date(savedState.expires_at).getTime() < Date.now()) return html("A autorização expirou ou já foi usada. Volte ao aplicativo e inicie novamente.", 400);
      await admin.from("drive_oauth_states").delete().eq("state_hash", stateHash);
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID"), clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
      if (!clientId || !clientSecret) return html("A configuração do Google Drive ainda está incompleta.", 503);
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }) });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) return html("O Google não concluiu a autorização. Volte ao aplicativo e tente novamente.", 400);
      let refreshToken = String(tokenData.refresh_token || "");
      if (!refreshToken) {
        const { data: prior } = await admin.rpc("drive_get_refresh_token");
        refreshToken = typeof prior === "string" ? prior : "";
      }
      if (!refreshToken) return html("O Google não forneceu a autorização persistente necessária. Revise o consentimento e tente novamente.", 400);
      const accessToken = String(tokenData.access_token);
      const { data: priorConfig } = await admin.from("drive_storage_config").select("folder_id").eq("id", true).maybeSingle();
      let folderId = String(priorConfig?.folder_id || "");
      if (!folderId) {
        const folderResponse = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType", accessToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Cadastro Criminal - Fotos", mimeType: "application/vnd.google-apps.folder" }) });
        const folder = await folderResponse.json();
        if (!folderResponse.ok || !folder.id) return html("A autorização funcionou, mas não foi possível preparar a pasta privada do aplicativo.", 502);
        folderId = String(folder.id);
      }
      const { error: saveError } = await admin.rpc("drive_store_credentials", { p_refresh_token: refreshToken, p_folder_id: folderId, p_actor: savedState.user_id });
      if (saveError) return html("A autorização foi recebida, mas o Supabase não confirmou o armazenamento seguro. Nenhuma foto foi movida.", 500);
      return html("Google Drive conectado com segurança.");
    }

    const master = await requireMaster(request);
    if (!master && !["photo", "upload", "status"].includes(route)) return response({ error: "Acesso exclusivo do administrador master." }, 403, origin);

    if (route === "oauth/start" && request.method === "POST") {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      if (!clientId || !Deno.env.get("GOOGLE_CLIENT_SECRET")) return response({ error: "Configuração OAuth incompleta." }, 503, origin);
      const { admin, userId } = master;
      await admin.from("drive_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const state = crypto.randomUUID() + crypto.randomUUID();
      const { error } = await admin.from("drive_oauth_states").insert({ state_hash: await sha256(state), user_id: userId, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (error) return response({ error: "Não foi possível iniciar a autorização." }, 500, origin);
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: "code", scope: "https://www.googleapis.com/auth/drive.file", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
      return response({ authorization_url: authUrl.toString() }, 200, origin);
    }

    if (route === "status" && request.method === "GET") {
      const actor = await userClient(request);
      if (!actor) return response({ error: "Sessão inválida." }, 401, origin);
      const { admin } = actor;
      const [{ data: config }, { data: token }] = await Promise.all([
        admin.from("drive_storage_config").select("folder_id,connected_at").eq("id", true).maybeSingle(),
        admin.rpc("drive_get_refresh_token"),
      ]);
      const connected = Boolean(config?.folder_id && token);
      let photos = null;
      if (master && connected) { try { photos = await drivePhotoCount(admin); } catch { /* Status remains useful if photo counts are temporarily unavailable. */ } }
      return response({ connected, connected_at: config?.connected_at || null, photos }, 200, origin);
    }
    if (route === "migrate-batch" && request.method === "POST") {
      const { admin, userId } = master;
      const { folderId, accessToken } = await driveCredentials(admin);
      const payload = await request.json().catch(() => ({}));
      const limit = Math.max(1, Math.min(2, Number(payload.limit) || 2));
      const { data: done, error: doneError } = await admin.from("drive_photo_migrations").select("source_path").eq("status", "active");
      if (doneError) throw doneError;
      const completed = new Set((done || []).map((row) => String(row.source_path)));
      let candidates: any[] = [];
      for (let offset = 0; offset < 20000 && candidates.length < limit; offset += 1000) {
        const { data, error } = await admin.from("record_photos").select("id,entity,entity_id,photo_path,city_id,is_cover").order("created_at").range(offset, offset + 999);
        if (error) throw error;
        const rows = (data || []).filter((row) => row.photo_path && !String(row.photo_path).startsWith("drive:") && !/^https?:\/\//i.test(String(row.photo_path)) && !completed.has(String(row.photo_path)));
        candidates.push(...rows.slice(0, limit - candidates.length));
        if (!data || data.length < 1000) break;
      }
      let copied = 0, failed = 0;
      for (const row of candidates) {
        const sourcePath = String(row.photo_path);
        const { data: original, error: downloadError } = await admin.storage.from("people-photos").download(sourcePath);
        if (downloadError || !original) { failed++; continue; }
        const bytes = new Uint8Array(await original.arrayBuffer());
        if (!bytes.length || bytes.length > 15 * 1024 * 1024) { failed++; continue; }
        const mime = original.type.startsWith("image/") ? original.type : "image/jpeg";
        const sha = await digest(bytes);
        const name = sourcePath.split("/").pop() || `${row.entity}-${row.entity_id}.jpg`;
        const fileId = await uploadDriveFile(accessToken, folderId, name, mime, bytes);
        const verifyResponse = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
        if (!verifyResponse.ok || await digest(new Uint8Array(await verifyResponse.arrayBuffer())) !== sha) { await deleteDriveFile(accessToken, fileId); failed++; continue; }
        const { error: mapError } = await admin.from("drive_photo_migrations").insert({ source_path: sourcePath, drive_file_id: fileId, entity: row.entity, entity_id: row.entity_id, city_id: row.city_id, sha256: sha, byte_size: bytes.length, status: "active", created_by: userId });
        if (mapError) { await deleteDriveFile(accessToken, fileId); if (mapError.code !== "23505") throw mapError; continue; }
        const drivePath = `drive:${fileId}`;
        const { error: photoError } = await admin.from("record_photos").update({ photo_path: drivePath }).eq("photo_path", sourcePath);
        if (photoError) { await admin.from("drive_photo_migrations").delete().eq("source_path", sourcePath); await deleteDriveFile(accessToken, fileId); throw photoError; }
        const { data: entityRecord, error: entityReadError } = await admin.from(row.entity).select("id,photo_path,photo_paths").eq("id", row.entity_id).maybeSingle();
        if (entityReadError) throw entityReadError;
        if (entityRecord) {
          const photoPaths = Array.isArray(entityRecord.photo_paths) ? entityRecord.photo_paths.map((path: string) => path === sourcePath ? drivePath : path) : entityRecord.photo_paths;
          const patch: Record<string, unknown> = { photo_paths: photoPaths };
          if (entityRecord.photo_path === sourcePath) patch.photo_path = drivePath;
          const { error: entityUpdateError } = await admin.from(row.entity).update(patch).eq("id", row.entity_id);
          if (entityUpdateError) { await admin.from("record_photos").update({ photo_path: sourcePath }).eq("photo_path", drivePath); await admin.from("drive_photo_migrations").delete().eq("source_path", sourcePath); await deleteDriveFile(accessToken, fileId); throw entityUpdateError; }
        }
        copied++;
      }
      return response({ copied, failed, photos: await drivePhotoCount(admin) }, 200, origin);
    }
    if (route === "rollback" && request.method === "POST") {
      const { admin } = master;
      const { data: mappings, error } = await admin.from("drive_photo_migrations").select("source_path,drive_file_id,entity,entity_id").eq("status", "active").limit(5000);
      if (error) throw error;
      let restored = 0;
      for (const mapping of mappings || []) {
        const drivePath = `drive:${mapping.drive_file_id}`;
        const { error: photoError } = await admin.from("record_photos").update({ photo_path: mapping.source_path }).eq("photo_path", drivePath);
        if (photoError) throw photoError;
        const { data: entityRecord, error: entityReadError } = await admin.from(mapping.entity).select("id,photo_path,photo_paths").eq("id", mapping.entity_id).maybeSingle();
        if (entityReadError) throw entityReadError;
        if (entityRecord) {
          const photoPaths = Array.isArray(entityRecord.photo_paths) ? entityRecord.photo_paths.map((path: string) => path === drivePath ? mapping.source_path : path) : entityRecord.photo_paths;
          const patch: Record<string, unknown> = { photo_paths: photoPaths };
          if (entityRecord.photo_path === drivePath) patch.photo_path = mapping.source_path;
          const { error: recordError } = await admin.from(mapping.entity).update(patch).eq("id", mapping.entity_id);
          if (recordError) throw recordError;
        }
        const { error: markError } = await admin.from("drive_photo_migrations").update({ status: "rolled_back", rolled_back_at: new Date().toISOString() }).eq("source_path", mapping.source_path);
        if (markError) throw markError;
        restored++;
      }
      return response({ restored, photos: await drivePhotoCount(admin) }, 200, origin);
    }
    if (route === "photo" && request.method === "GET") {
      const actor = await userClient(request);
      const fileId = url.searchParams.get("id") || "";
      if (!actor || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return response({ error: "Acesso não autorizado." }, 401, origin);
      const { data: allowed, error } = await actor.client.from("record_photos").select("id").eq("photo_path", `drive:${fileId}`).limit(1).maybeSingle();
      if (error || !allowed) return response({ error: "Foto não disponível para este usuário." }, 403, origin);
      const { accessToken } = await driveCredentials(actor.admin);
      const file = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
      if (!file.ok) return response({ error: "Não foi possível carregar a foto." }, 404, origin);
      const headers = new Headers({ "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Type": file.headers.get("Content-Type") || "application/octet-stream" });
      if (ALLOWED_ORIGINS.has(origin)) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Vary", "Origin"); }
      return new Response(file.body, { status: 200, headers });
    }
    if (route === "upload" && request.method === "POST") {
      const actor = await userClient(request);
      if (!actor) return response({ error: "Sessão inválida." }, 401, origin);
      const form = await request.formData();
      const entity = String(form.get("entity") || "");
      const entityId = String(form.get("entity_id") || "");
      const file = form.get("file");
      if (!(["people", "vehicles"].includes(entity)) || !/^[0-9a-f-]{36}$/i.test(entityId) || !(file instanceof File) || !file.type.startsWith("image/") || file.size < 1 || file.size > 15 * 1024 * 1024) return response({ error: "Dados ou imagem inválidos (máximo 15 MB)." }, 400, origin);
      const { data: record, error: recordError } = await actor.client.from(entity).select("id,photo_path").eq("id", entityId).maybeSingle();
      if (recordError || !record) return response({ error: "Cadastro não acessível." }, 403, origin);
      const { folderId, accessToken } = await driveCredentials(actor.admin);
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const fileId = await uploadDriveFile(accessToken, folderId, `${entity}-${entityId}-${crypto.randomUUID()}.${ext}`, file.type, new Uint8Array(await file.arrayBuffer()));
      const { data: coverRows, error: coverError } = await actor.client.from("record_photos").select("id").eq("entity", entity).eq("entity_id", entityId).eq("is_cover", true).limit(1);
      if (coverError) { await deleteDriveFile(await driveCredentials(actor.admin).then((x) => x.accessToken), fileId); return response({ error: "Não foi possível verificar a foto de capa." }, 500, origin); }
      const forceCover = form.get("force_cover") === "true";
      const neverCover = form.get("never_cover") === "true";
      const isCover = !neverCover && (forceCover || (!coverRows?.length && !record.photo_path));
      const drivePath = `drive:${fileId}`;
      const { error: insertError } = await actor.client.from("record_photos").insert({ entity, entity_id: entityId, photo_path: drivePath, is_cover: isCover, created_by: actor.userId });
      if (insertError) { await deleteDriveFile(accessToken, fileId); return response({ error: "A foto foi enviada, mas não pôde ser vinculada." }, 500, origin); }
      if (isCover) {
        const { error: updateError } = await actor.client.from(entity).update({ photo_path: drivePath, updated_by: actor.userId }).eq("id", entityId);
        if (updateError) return response({ error: "Foto vinculada, mas não foi possível atualizar a capa." }, 500, origin);
      }
      return response({ ok: true, photo_path: drivePath, is_cover: isCover }, 201, origin);
    }
    return response({ error: "Rota não encontrada." }, 404, origin);
  } catch {
    return route === "oauth/callback" ? html("Falha segura ao configurar o Google Drive. Nenhuma foto foi movida.", 500) : response({ error: "Não foi possível concluir a operação." }, 500, origin);
  }
});

