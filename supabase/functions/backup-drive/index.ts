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
async function requireMigrationCron(request: Request) {
  const supplied = request.headers.get("x-drive-cron-token") || "";
  if (supplied.length < 32) return null;
  const { admin } = clients();
  const [{ data: expected, error: secretError }, { data: actor, error: actorError }] = await Promise.all([
    admin.rpc("drive_get_migration_cron_secret"),
    admin.from("drive_photo_migration_queue").select("requested_by").order("created_at").limit(1).maybeSingle(),
  ]);
  if (secretError || actorError || typeof expected !== "string" || supplied !== expected || !actor?.requested_by) return null;
  return { admin, userId: String(actor.requested_by) };
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
  const { data, error } = await admin.rpc("drive_photo_migration_progress");
  if (error) throw error;
  const progress = Array.isArray(data) ? data[0] : data;
  if (!progress || !Number.isFinite(Number(progress.total)) || !Number.isFinite(Number(progress.migrated)) || !Number.isFinite(Number(progress.remaining))) {
    throw new Error("Não foi possível calcular o progresso da migração.");
  }
  return {
    total: Number(progress.total),
    migrated: Number(progress.migrated),
    remaining: Number(progress.remaining),
  };
}

function photoKind(value: string) {
  return /^https?:\/\//i.test(value) ? "url" : "storage";
}

async function collectPhotoReferences(admin: ReturnType<typeof clients>["admin"]) {
  const refs = new Map<string, { source_path: string; source_kind: "storage" | "url"; entity: "people" | "vehicles"; entity_id: string; city_id: string | null }>();
  const add = (raw: unknown, entity: string, entityId: string, cityId: string | null) => {
    if ((entity !== "people" && entity !== "vehicles") || typeof raw !== "string") return;
    const sourcePath = raw.trim();
    if (!sourcePath || sourcePath.startsWith("drive:") || sourcePath.startsWith("data:") || sourcePath.startsWith("blob:")) return;
    if (!refs.has(sourcePath)) refs.set(sourcePath, { source_path: sourcePath, source_kind: photoKind(sourcePath), entity, entity_id: entityId, city_id: cityId });
  };
  for (const table of ["people", "vehicles"] as const) {
    for (let offset = 0; offset < 50000; offset += 1000) {
      const { data, error } = await admin.from(table).select("id,photo_path,photo_paths,city_id").order("id").range(offset, offset + 999);
      if (error) throw error;
      for (const row of data || []) {
        add(row.photo_path, table, String(row.id), row.city_id ? String(row.city_id) : null);
        if (Array.isArray(row.photo_paths)) for (const path of row.photo_paths) add(path, table, String(row.id), row.city_id ? String(row.city_id) : null);
      }
      if (!data || data.length < 1000) break;
    }
  }
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await admin.from("record_photos").select("entity,entity_id,photo_path,city_id").order("id").range(offset, offset + 999);
    if (error) throw error;
    for (const row of data || []) add(row.photo_path, String(row.entity), String(row.entity_id), row.city_id ? String(row.city_id) : null);
    if (!data || data.length < 1000) break;
  }
  return refs;
}

async function prepareMigrationQueue(admin: ReturnType<typeof clients>["admin"], userId: string) {
  const refs = await collectPhotoReferences(admin);
  const { data: maps, error: mapError } = await admin.from("drive_photo_migrations").select("source_path").eq("status", "active");
  if (mapError) throw mapError;
  const alreadyMapped = new Set((maps || []).map((row) => String(row.source_path)));
  const rows = [...refs.values()].filter((row) => !alreadyMapped.has(row.source_path)).map((row) => ({ ...row, requested_by: userId }));
  const chunks: typeof rows[] = [];
  for (let offset = 0; offset < rows.length; offset += 500) chunks.push(rows.slice(offset, offset + 500));
  for (let offset = 0; offset < chunks.length; offset += 4) {
    const results = await Promise.all(chunks.slice(offset, offset + 4).map((chunk) => admin.from("drive_photo_migration_queue").upsert(chunk, { onConflict: "source_path", ignoreDuplicates: true })));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  }
  return rows.length;
}

const IMAGE_SOURCE_HOSTS = new Set(["drive.google.com", "drive.usercontent.google.com", "drive.googleusercontent.com", "lh3.googleusercontent.com", "storage.googleapis.com"]);
const MAX_MIGRATION_IMAGE_BYTES = 15 * 1024 * 1024;

function sniffImageMime(bytes: Uint8Array, declared: string) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG") return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  const normalized = (declared || "").split(";")[0].trim().toLowerCase();
  return ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic"].includes(normalized) ? normalized : "";
}

function safeSourceUrl(raw: string) {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("invalid_url"); }
  if (!["http:", "https:"].includes(parsed.protocol) || !IMAGE_SOURCE_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("unsupported_host");
  parsed.protocol = "https:";
  return parsed;
}

async function fetchAllowedImage(rawUrl: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const initial = safeSourceUrl(rawUrl);
  const candidates = [initial];
  if (initial.hostname === "drive.google.com") {
    let fileId = initial.searchParams.get("id") || initial.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || "";
    if (fileId && /^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
      const direct = new URL("https://drive.google.com/uc");
      direct.searchParams.set("export", "download"); direct.searchParams.set("id", fileId);
      candidates.push(direct);
    }
  }
  let lastCode = "source_unavailable";
  for (const start of candidates) {
    let target = start;
    for (let redirects = 0; redirects <= 4; redirects++) {
      const checked = safeSourceUrl(target.toString());
      const result = await fetch(checked.toString(), { redirect: "manual", headers: { "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" } });
      if (result.status >= 300 && result.status < 400) {
        const location = result.headers.get("location");
        if (!location) { lastCode = "source_redirect_invalid"; break; }
        try { target = new URL(location, checked); safeSourceUrl(target.toString()); } catch { lastCode = "unsupported_redirect"; break; }
        continue;
      }
      if (!result.ok) { lastCode = result.status === 404 ? "source_not_found" : "source_unavailable"; break; }
      const declaredLength = Number(result.headers.get("content-length") || 0);
      if (declaredLength > MAX_MIGRATION_IMAGE_BYTES) { lastCode = "image_too_large"; break; }
      const buffer = new Uint8Array(await result.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_MIGRATION_IMAGE_BYTES) { lastCode = buffer.length ? "image_too_large" : "empty_image"; break; }
      let mime = sniffImageMime(buffer, result.headers.get("content-type") || "");
      if (!mime && checked.hostname === "drive.google.com" && (result.headers.get("content-type") || "").includes("text/html")) {
        const html = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.length, 1024 * 1024)));
        const confirmation = html.match(/[?&]confirm=([\w-]+)/)?.[1] || html.match(/name="confirm"\s+value="([\w-]+)"/i)?.[1];
        if (confirmation) {
          const retry = new URL(checked.toString()); retry.searchParams.set("confirm", confirmation);
          candidates.push(retry);
          lastCode = "drive_confirmation_required"; break;
        }
        lastCode = "source_not_image"; break;
      }
      if (!mime) { lastCode = "source_not_image"; break; }
      return { bytes: buffer, mime };
    }
  }
  throw new Error(lastCode);
}

async function loadMigrationImage(admin: ReturnType<typeof clients>["admin"], sourcePath: string, sourceKind: string) {
  if (sourceKind === "url") return await fetchAllowedImage(sourcePath);
  const { data, error } = await admin.storage.from("people-photos").download(sourcePath);
  if (error || !data) throw new Error("storage_object_missing");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_MIGRATION_IMAGE_BYTES) throw new Error(bytes.length ? "image_too_large" : "empty_image");
  const mime = sniffImageMime(bytes, data.type || "");
  if (!mime) throw new Error("source_not_image");
  return { bytes, mime };
}

async function rowsForPhotoReference(admin: ReturnType<typeof clients>["admin"], entity: "people" | "vehicles", sourcePath: string) {
  const rows = new Map<string, any>();
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await admin.from(entity).select("id,photo_path,photo_paths,city_id").eq("photo_path", sourcePath).order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data || []) rows.set(String(row.id), row);
    if (!data || data.length < 500) break;
  }
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await admin.from(entity).select("id,photo_path,photo_paths,city_id").contains("photo_paths", [sourcePath]).order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data || []) rows.set(String(row.id), row);
    if (!data || data.length < 500) break;
  }
  return [...rows.values()];
}

async function replacePhotoReferences(admin: ReturnType<typeof clients>["admin"], sourcePath: string, drivePath: string, userId: string) {
  const { error: photosError } = await admin.from("record_photos").update({ photo_path: drivePath }).eq("photo_path", sourcePath);
  if (photosError) throw photosError;
  for (const entity of ["people", "vehicles"] as const) {
    const rows = await rowsForPhotoReference(admin, entity, sourcePath);
    for (const row of rows) {
      const photoPaths = Array.isArray(row.photo_paths) ? row.photo_paths.map((path: string) => path === sourcePath ? drivePath : path) : row.photo_paths;
      const patch: Record<string, unknown> = { photo_paths: photoPaths, updated_by: userId };
      if (row.photo_path === sourcePath) patch.photo_path = drivePath;
      const { error } = await admin.from(entity).update(patch).eq("id", row.id);
      if (error) throw error;
    }
    if (rows.length) {
      const ids = rows.map((row) => String(row.id));
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const { data: existing, error: existingError } = await admin.from("record_photos").select("entity_id").eq("entity", entity).eq("photo_path", drivePath).in("entity_id", batch);
        if (existingError) throw existingError;
        const linked = new Set((existing || []).map((row) => String(row.entity_id)));
        const missing = rows.filter((row) => batch.includes(String(row.id)) && !linked.has(String(row.id))).map((row) => ({ entity, entity_id: row.id, photo_path: drivePath, is_cover: row.photo_path === sourcePath, created_by: userId, city_id: row.city_id || null }));
        if (missing.length) {
          const { error } = await admin.from("record_photos").insert(missing);
          if (error) throw error;
        }
      }
    }
  }
}

async function findActivePhotoMap(admin: ReturnType<typeof clients>["admin"], sourcePath: string) {
  const { data, error } = await admin.from("drive_photo_migrations").select("source_path,drive_file_id,sha256,status").eq("source_path", sourcePath).maybeSingle();
  if (error) throw error;
  return data;
}

async function restorePhotoReferences(admin: ReturnType<typeof clients>["admin"], drivePath: string, sourcePath: string, userId: string) {
  for (const entity of ["people", "vehicles"] as const) {
    const rows = await rowsForPhotoReference(admin, entity, drivePath);
    for (const row of rows) {
      const photoPaths = Array.isArray(row.photo_paths) ? row.photo_paths.map((path: string) => path === drivePath ? sourcePath : path) : row.photo_paths;
      const patch: Record<string, unknown> = { photo_paths: photoPaths, updated_by: userId };
      if (row.photo_path === drivePath) patch.photo_path = sourcePath;
      const { error } = await admin.from(entity).update(patch).eq("id", row.id);
      if (error) throw error;
    }
  }
  const { error } = await admin.from("record_photos").update({ photo_path: sourcePath }).eq("photo_path", drivePath);
  if (error) throw error;
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

    let master: { admin: ReturnType<typeof clients>["admin"]; userId: string } | null;
    if (route === "cron-batch") {
      if (request.method !== "POST") return response({ error: "Método não permitido." }, 405, origin);
      master = await requireMigrationCron(request);
    } else {
      master = await requireMaster(request);
    }
    if (!master && !["photo", "upload", "status", "pdf", "pdf-migrate-one"].includes(route)) return response({ error: "Acesso exclusivo do administrador master." }, 403, origin);

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
      let connected = false;
      if (config?.folder_id && typeof token === "string") {
        try { await googleAccessToken(token); connected = true; } catch { connected = false; }
      }
      let photos = null;
      let pdfs = null;
      if (master) {
        try {
          await admin.rpc("drive_enqueue_existing_pdfs");
          pdfs = await drivePdfProgress(admin);
        } catch { /* Keep connection status visible if PDF inventory is unavailable. */ }
      }
      if (master && connected) {
        try {
          const { count, error: queueError } = await admin.from("drive_photo_migration_queue").select("source_path", { count: "exact", head: true });
          if (queueError) throw queueError;
          if (!count) await prepareMigrationQueue(admin, master.userId);
          photos = await drivePhotoCount(admin);
        } catch { /* Keep connection status visible if the photo migration inventory is unavailable. */ }
      }
      return response({ connected, connected_at: config?.connected_at || null, photos, pdfs }, 200, origin);
    }
    if ((route === "migrate-batch" || route === "cron-batch") && request.method === "POST") {
      const { admin, userId } = master;
      const { folderId, accessToken } = await driveCredentials(admin);
      const payload = await request.json().catch(() => ({}));
      const limit = Math.max(1, Math.min(4, Number(payload.limit) || 4));
      const { count: queueCount, error: queueCountError } = await admin.from("drive_photo_migration_queue").select("source_path", { count: "exact", head: true });
      if (queueCountError) throw queueCountError;
      if (!queueCount) await prepareMigrationQueue(admin, userId);
      await admin.from("drive_photo_migration_queue").update({ status: "pending", updated_at: new Date().toISOString() }).eq("status", "processing").lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());
      let { data: candidates, error: candidateError } = await admin.from("drive_photo_migration_queue").select("source_path,source_kind,entity,entity_id,city_id,attempts").eq("status", "pending").order("created_at").limit(limit);
      if (candidateError) throw candidateError;
      if (!candidates?.length) {
        const retried = await admin.from("drive_photo_migration_queue").select("source_path,source_kind,entity,entity_id,city_id,attempts").eq("status", "failed").lt("attempts", 3).order("attempts").order("created_at").limit(limit);
        if (retried.error) throw retried.error;
        candidates = retried.data || [];
      }
      let copied = 0, failed = 0;
      const prepared: Array<{ row: any; fileId: string; sha: string; byteSize: number; existingMap: boolean }> = [];
      const outcomes = await Promise.all((candidates || []).map(async (row) => {
        const sourcePath = String(row.source_path);
        const { data: claimed, error: claimError } = await admin.from("drive_photo_migration_queue").update({ status: "processing", attempts: Number(row.attempts || 0) + 1, updated_at: new Date().toISOString(), last_error_code: null }).eq("source_path", sourcePath).in("status", ["pending", "failed"]).select("source_path").maybeSingle();
        if (claimError) return { row, errorCode: "queue_claim_failed" };
        if (!claimed) return { row, skipped: true };
        try {
          const map = await findActivePhotoMap(admin, sourcePath);
          if (map?.status === "active") return { row, fileId: String(map.drive_file_id), sha: String(map.sha256), byteSize: 0, existingMap: true };
          const image = await loadMigrationImage(admin, sourcePath, String(row.source_kind));
          const sha = await digest(image.bytes);
          const ext = image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : image.mime === "image/gif" ? "gif" : image.mime === "image/avif" ? "avif" : image.mime === "image/heic" ? "heic" : "jpg";
          const fileId = await uploadDriveFile(accessToken, folderId, `foto-${sha.slice(0, 20)}.${ext}`, image.mime, image.bytes);
          const verifyResponse = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, accessToken);
          if (!verifyResponse.ok || await digest(new Uint8Array(await verifyResponse.arrayBuffer())) !== sha) {
            await deleteDriveFile(accessToken, fileId);
            throw new Error("drive_verification_failed");
          }
          return { row, fileId, sha, byteSize: image.bytes.length, existingMap: false };
        } catch (error) {
          const errorCode = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "copy_failed";
          return { row, errorCode };
        }
      }));
      for (const outcome of outcomes) {
        const row = outcome.row;
        const sourcePath = String(row.source_path);
        if ("skipped" in outcome) continue;
        if ("errorCode" in outcome) {
          failed++;
          await admin.from("drive_photo_migration_queue").update({ status: "failed", last_error_code: outcome.errorCode, updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
          continue;
        }
        const drivePath = `drive:${outcome.fileId}`;
        if (!outcome.existingMap) {
          const mapData = { source_path: sourcePath, drive_file_id: outcome.fileId, entity: row.entity, entity_id: row.entity_id, city_id: row.city_id, sha256: outcome.sha, byte_size: outcome.byteSize, status: "active", rolled_back_at: null, created_by: userId };
          const { data: prior, error: priorError } = await admin.from("drive_photo_migrations").select("source_path,status").eq("source_path", sourcePath).maybeSingle();
          if (priorError) throw priorError;
          const mapResult = prior
            ? await admin.from("drive_photo_migrations").update(mapData).eq("source_path", sourcePath)
            : await admin.from("drive_photo_migrations").insert(mapData);
          if (mapResult.error) {
            if (!prior) await deleteDriveFile(accessToken, outcome.fileId);
            await admin.from("drive_photo_migration_queue").update({ status: "failed", last_error_code: "mapping_write_failed", updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
            failed++;
            continue;
          }
        }
        try {
          await replacePhotoReferences(admin, sourcePath, drivePath, userId);
          const { error: doneError } = await admin.from("drive_photo_migration_queue").update({ status: "copied", drive_file_id: outcome.fileId, sha256: outcome.sha, byte_size: outcome.byteSize, last_error_code: null, updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
          if (doneError) throw doneError;
          copied++;
        } catch {
          failed++;
          await admin.from("drive_photo_migration_queue").update({ status: "failed", last_error_code: "reference_update_failed", updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
        }
      }
      return response({ copied, failed, photos: await drivePhotoCount(admin) }, 200, origin);
    }
    if (route === "rollback" && request.method === "POST") {
      const { admin, userId } = master;
      const { data: mappings, error } = await admin.from("drive_photo_migrations").select("source_path,drive_file_id").eq("status", "active").order("source_path").limit(20);
      if (error) throw error;
      let restored = 0;
      for (const mapping of mappings || []) {
        const drivePath = `drive:${mapping.drive_file_id}`;
        await restorePhotoReferences(admin, drivePath, mapping.source_path, userId);
        const { error: markError } = await admin.from("drive_photo_migrations").update({ status: "rolled_back", rolled_back_at: new Date().toISOString() }).eq("source_path", mapping.source_path);
        if (markError) throw markError;
        await admin.from("drive_photo_migration_queue").update({ status: "pending", drive_file_id: null, sha256: null, byte_size: null, last_error_code: null, updated_at: new Date().toISOString() }).eq("source_path", mapping.source_path);
        restored++;
      }
      const { count: activeRemaining, error: remainingError } = await admin.from("drive_photo_migrations").select("source_path", { count: "exact", head: true }).eq("status", "active");
      if (remainingError) throw remainingError;
      return response({ restored, more: (activeRemaining || 0) > 0, active_remaining: activeRemaining || 0, photos: await drivePhotoCount(admin) }, 200, origin);
    }
async function drivePdfProgress(admin: ReturnType<typeof clients>["admin"]) {
  const { data, error } = await admin.rpc("drive_pdf_migration_progress");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { total: 0, migrated: 0, remaining: 0, failed: 0 };
  return { total: Number(row.total || 0), migrated: Number(row.migrated || 0), remaining: Number(row.remaining || 0), failed: Number(row.failed || 0) };
}
async function updateWarrantPdfReferences(admin: ReturnType<typeof clients>["admin"], sourcePath: string, drivePath: string) {
  const docs = await admin.from("arrest_warrant_documents").update({ storage_path: drivePath }).eq("storage_path", sourcePath);
  if (docs.error) throw docs.error;
  const duplicates = await admin.from("arrest_warrant_duplicate_submissions").update({ storage_path: drivePath }).eq("storage_path", sourcePath);
  if (duplicates.error) throw duplicates.error;
}
async function copyWarrantPdf(admin: ReturnType<typeof clients>["admin"], accessToken: string, folderId: string, sourcePath: string, fileName: string, userId: string) {
  const queueUpdate = (patch: Record<string, unknown>) => admin.from("drive_pdf_migration_queue").update({ ...patch, updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
  const { data: prior, error: priorError } = await admin.from("drive_pdf_migrations").select("drive_file_id,sha256,byte_size,status").eq("source_path", sourcePath).maybeSingle();
  if (priorError) throw priorError;
  if (prior?.status === "active") {
    const drivePath = "drive:" + String(prior.drive_file_id);
    await updateWarrantPdfReferences(admin, sourcePath, drivePath);
    const done = await queueUpdate({ status: "copied", drive_file_id: prior.drive_file_id, sha256: prior.sha256, byte_size: prior.byte_size, last_error_code: null });
    if (done.error) throw done.error;
    return { copied: true, bytes: Number(prior.byte_size || 0), reused: true };
  }
  const { data, error } = await admin.storage.from("warrant-documents").download(sourcePath);
  if (error || !data) throw new Error("source_pdf_missing");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error(bytes.length ? "pdf_too_large" : "empty_pdf");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("invalid_pdf");
  const sha = await digest(bytes);
  let safeName = fileName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100);
  if (!safeName.toLowerCase().endsWith(".pdf")) safeName += ".pdf";
  const driveName = "mandado-" + sha.slice(0, 12) + "-" + safeName;
  const fileId = await uploadDriveFile(accessToken, folderId, driveName, "application/pdf", bytes);
  try {
    const verified = await driveFetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", accessToken);
    if (!verified.ok || await digest(new Uint8Array(await verified.arrayBuffer())) !== sha) throw new Error("drive_verification_failed");
    const mapping = await admin.from("drive_pdf_migrations").upsert({ source_path: sourcePath, drive_file_id: fileId, file_name: fileName, sha256: sha, byte_size: bytes.length, status: "active", migrated_at: new Date().toISOString(), rolled_back_at: null, created_by: userId }, { onConflict: "source_path" });
    if (mapping.error) throw new Error("mapping_write_failed");
    await updateWarrantPdfReferences(admin, sourcePath, "drive:" + fileId);
    const done = await queueUpdate({ status: "copied", drive_file_id: fileId, sha256: sha, byte_size: bytes.length, last_error_code: null });
    if (done.error) throw new Error("queue_update_failed");
    return { copied: true, bytes: bytes.length, reused: false };
  } catch (error) {
    await deleteDriveFile(accessToken, fileId);
    throw error;
  }
}

    if (route === "pdf-migrate-batch" && request.method === "POST") {
      if (!master) return response({ error: "Acesso exclusivo do administrador master." }, 403, origin);
      const { admin, userId } = master;
      const { folderId, accessToken } = await driveCredentials(admin);
      await admin.rpc("drive_enqueue_existing_pdfs");
      const payload = await request.json().catch(() => ({}));
      const limit = Math.max(1, Math.min(3, Number(payload.limit) || 2));
      const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
      await admin.from("drive_pdf_migration_queue").update({ status: "pending", updated_at: new Date().toISOString() }).eq("status", "processing").lt("updated_at", staleAt);
      const { count: pendingCount } = await admin.from("drive_pdf_migration_queue").select("source_path", { count: "exact", head: true }).eq("status", "pending");
      if (!pendingCount) await admin.from("drive_pdf_migration_queue").update({ status: "pending", attempts: 0, updated_at: new Date().toISOString(), last_error_code: null }).eq("status", "failed");
      const { data: rows, error } = await admin.from("drive_pdf_migration_queue").select("source_path,file_name,attempts").eq("status", "pending").order("created_at").limit(limit);
      if (error) throw error;
      let copied = 0, failed = 0;
      for (const row of rows || []) {
        const sourcePath = String(row.source_path);
        const { data: claimed, error: claimError } = await admin.from("drive_pdf_migration_queue").update({ status: "processing", attempts: Number(row.attempts || 0) + 1, updated_at: new Date().toISOString(), last_error_code: null }).eq("source_path", sourcePath).eq("status", "pending").select("source_path").maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) continue;
        try {
          await copyWarrantPdf(admin, accessToken, folderId, sourcePath, String(row.file_name || "mandado.pdf"), userId);
          copied++;
        } catch (error) {
          const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "copy_failed";
          await admin.from("drive_pdf_migration_queue").update({ status: "failed", last_error_code: code, updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
          failed++;
        }
      }
      return response({ copied, failed, pdfs: await drivePdfProgress(admin) }, 200, origin);
    }
    if (route === "pdf-migrate-one" && request.method === "POST") {
      const actor = await userClient(request);
      if (!actor) return response({ error: "Sessão inválida." }, 401, origin);
      const body = await request.json().catch(() => ({}));
      const docId = String(body.document_id || "");
      const submissionId = String(body.submission_id || "");
      let sourcePath = "", fileName = "mandado.pdf";
      if (docId) {
        const { data, error } = await actor.client.from("arrest_warrant_documents").select("storage_path,file_name").eq("id", docId).maybeSingle();
        if (error || !data) return response({ error: "Documento não acessível." }, 403, origin);
        sourcePath = String(data.storage_path || ""); fileName = String(data.file_name || fileName);
      } else if (submissionId) {
        const { data, error } = await actor.client.from("arrest_warrant_duplicate_submissions").select("storage_path,document_name").eq("id", submissionId).maybeSingle();
        if (error || !data) return response({ error: "Documento não acessível." }, 403, origin);
        sourcePath = String(data.storage_path || ""); fileName = String(data.document_name || fileName);
      } else return response({ error: "Informe um documento salvo." }, 400, origin);
      if (!sourcePath || sourcePath.startsWith("drive:")) return response({ ok: true, already_migrated: true }, 200, origin);
      const { folderId, accessToken } = await driveCredentials(actor.admin);
      const { data: queued, error: queueError } = await actor.admin.from("drive_pdf_migration_queue").upsert({ source_path: sourcePath, file_name: fileName, status: "pending", requested_by: actor.userId }, { onConflict: "source_path", ignoreDuplicates: true }).select("source_path").maybeSingle();
      if (queueError) return response({ error: "Não foi possível preparar a cópia do PDF." }, 500, origin);
      const { data: row, error: readError } = await actor.admin.from("drive_pdf_migration_queue").select("source_path,file_name,attempts,status").eq("source_path", sourcePath).maybeSingle();
      if (readError || !row) return response({ error: "PDF não entrou na fila de cópia." }, 500, origin);
      if (row.status !== "copied") {
        const { data: claimed, error: claimError } = await actor.admin.from("drive_pdf_migration_queue").update({ status: "processing", attempts: Number(row.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq("source_path", sourcePath).in("status", ["pending","failed","processing"]).select("source_path").maybeSingle();
        if (claimError || !claimed) return response({ error: "PDF já está sendo processado. A cópia continuará na fila." }, 202, origin);
        try { await copyWarrantPdf(actor.admin, accessToken, folderId, sourcePath, fileName, actor.userId); }
        catch (error) {
          const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "copy_failed";
          await actor.admin.from("drive_pdf_migration_queue").update({ status: "failed", last_error_code: code, updated_at: new Date().toISOString() }).eq("source_path", sourcePath);
          return response({ error: "O PDF foi salvo no Supabase, mas a cópia segura no Drive falhou. Ele permanece disponível e poderá ser tentado novamente.", code }, 502, origin);
        }
      }
      return response({ ok: true, pdfs: await drivePdfProgress(actor.admin) }, 200, origin);
    }
    if (route === "pdf-migrate-rollback" && request.method === "POST") {
      if (!master) return response({ error: "Acesso exclusivo do administrador master." }, 403, origin);
      const { admin } = master;
      const { data: maps, error } = await admin.from("drive_pdf_migrations").select("source_path,drive_file_id").eq("status", "active").order("migrated_at").limit(20);
      if (error) throw error;
      let restored = 0;
      for (const map of maps || []) {
        const drivePath = "drive:" + map.drive_file_id;
        await admin.from("arrest_warrant_documents").update({ storage_path: map.source_path }).eq("storage_path", drivePath);
        await admin.from("arrest_warrant_duplicate_submissions").update({ storage_path: map.source_path }).eq("storage_path", drivePath);
        const { error: markError } = await admin.from("drive_pdf_migrations").update({ status: "rolled_back", rolled_back_at: new Date().toISOString() }).eq("source_path", map.source_path);
        if (markError) throw markError;
        await admin.from("drive_pdf_migration_queue").update({ status: "pending", updated_at: new Date().toISOString() }).eq("source_path", map.source_path);
        restored++;
      }
      const progress = await drivePdfProgress(admin);
      return response({ restored, more: progress.migrated > 0, pdfs: progress }, 200, origin);
    }
    if (route === "pdf" && request.method === "GET") {
      const actor = await userClient(request);
      const fileId = url.searchParams.get("id") || "";
      if (!actor || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return response({ error: "Acesso não autorizado." }, 401, origin);
      const drivePath = "drive:" + fileId;
      const [doc, duplicate] = await Promise.all([
        actor.client.from("arrest_warrant_documents").select("id").eq("storage_path", drivePath).limit(1).maybeSingle(),
        actor.client.from("arrest_warrant_duplicate_submissions").select("id").eq("storage_path", drivePath).limit(1).maybeSingle()
      ]);
      if (!doc.data && !duplicate.data) return response({ error: "Documento não disponível para este usuário." }, 403, origin);
      const { accessToken } = await driveCredentials(actor.admin);
      const file = await driveFetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", accessToken);
      if (!file.ok) return response({ error: "Não foi possível carregar o PDF." }, 404, origin);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return response({ error: "Arquivo PDF inválido." }, 415, origin);
      const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/pdf", "Content-Length": String(bytes.length) });
      if (ALLOWED_ORIGINS.has(origin)) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Vary", "Origin"); }
      return new Response(bytes, { status: 200, headers });
    }
    if (route === "photo" && request.method === "GET") {
      const actor = await userClient(request);
      const fileId = url.searchParams.get("id") || "";
      if (!actor || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return response({ error: "Acesso não autorizado." }, 401, origin);
      const drivePath = `drive:${fileId}`;
      const { data: galleryReference, error: galleryError } = await actor.client.from("record_photos").select("id").eq("photo_path", drivePath).limit(1).maybeSingle();
      if (galleryError) return response({ error: "Foto não disponível para este usuário." }, 403, origin);
      let allowed = Boolean(galleryReference);
      if (!allowed) {
        // Some existing covers are stored only in the record's canonical photo_path/photo_paths fields.
        // Query through the authenticated client so each lookup remains constrained by the existing RLS policies.
        const references = await Promise.all(([["people", "photo_path"], ["vehicles", "photo_path"]] as const).map(([table, column]) =>
          actor.client.from(table).select("id").eq(column, drivePath).limit(1).maybeSingle()
        ));
        if (references.some((result) => result.error)) return response({ error: "Foto não disponível para este usuário." }, 403, origin);
        allowed = references.some((result) => Boolean(result.data));
      }
      if (!allowed) {
        const legacyReferences = await Promise.all((["people", "vehicles"] as const).map((table) =>
          actor.client.from(table).select("id").contains("photo_paths", [drivePath]).limit(1).maybeSingle()
        ));
        if (legacyReferences.some((result) => result.error)) return response({ error: "Foto não disponível para este usuário." }, 403, origin);
        allowed = legacyReferences.some((result) => Boolean(result.data));
      }
      if (!allowed) return response({ error: "Foto não disponível para este usuário." }, 403, origin);
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

