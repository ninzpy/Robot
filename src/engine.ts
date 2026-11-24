// Serves /blox/engine/*. Nothing is stored on disk: every file is streamed from
// Roblox's CDN (setup.rbxcdn.com), the same fallback the original server uses.
const BINARY_TYPE = "WebClientApp";
const CLIENT_VERSION_URL = `https://clientsettings.roblox.com/v2/client-version/${BINARY_TYPE}`;
const FLAGS_URL = `https://clientsettingscdn.roblox.com/v2/settings/application/${BINARY_TYPE}`;
const CDN = "https://setup.rbxcdn.com/webclient";
const VERSION_RE = /^version-[0-9a-f]{16}$/;
const ENGINE_PATH = /^[A-Za-z0-9_@ .()+-]+(?:\/[A-Za-z0-9_@ .()+-]+)*$/;
const DEFAULT_GRAPHICS_QUALITY_FLAG = "DFIntDebugFRMQualityLevelOverride";
const PREFIX = "/blox/engine/";

const MIME: Record<string, string> = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  otf: "font/otf",
  png: "image/png",
  ttf: "font/ttf",
  wasm: "application/wasm",
};

export interface EngineEnv {
  ENGINE_VERSION?: string;
}

function isolated(headers: Record<string, string>): Headers {
  return new Headers({
    ...headers,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: isolated({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }) });

let cachedVersion: { upload: string; at: number } | null = null;

async function engineVersion(env: EngineEnv): Promise<string> {
  if (env.ENGINE_VERSION) {
    if (!VERSION_RE.test(env.ENGINE_VERSION)) throw new Error("ENGINE_VERSION must look like version-<16 hex>");
    return env.ENGINE_VERSION;
  }
  if (cachedVersion && Date.now() - cachedVersion.at < 5 * 60_000) return cachedVersion.upload;
  const res = await fetch(CLIENT_VERSION_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`client-version: HTTP ${res.status}`);
  const upload = ((await res.json()) as { clientVersionUpload?: string }).clientVersionUpload ?? "";
  if (!VERSION_RE.test(upload)) throw new Error("unexpected client-version response");
  cachedVersion = { upload, at: Date.now() };
  return upload;
}

async function pinnedFlags(env: EngineEnv): Promise<Response> {
  const upload = await engineVersion(env);
  const res = await fetch(FLAGS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`flags: HTTP ${res.status}`);
  const flags = (await res.json()) as { applicationSettings?: Record<string, unknown> };
  if (!flags.applicationSettings) throw new Error("flags response has no applicationSettings");
  return new Response(
    JSON.stringify({
      engine: upload,
      pinnedAt: new Date().toISOString(),
      applicationSettings: { ...flags.applicationSettings, [DEFAULT_GRAPHICS_QUALITY_FLAG]: "1" },
    }),
    { headers: isolated({ "content-type": MIME.json!, "cache-control": "no-cache" }) },
  );
}

export async function handleEngine(request: Request, env: EngineEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: isolated({ allow: "GET, HEAD" }) });
  }
  const url = new URL(request.url);
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname.slice(PREFIX.length));
  } catch {
    return notFound();
  }
  if (!ENGINE_PATH.test(relative) || relative.split("/").some((p) => p === "." || p === "..")) return notFound();

  try {
    if (relative === "PinnedFlags.json") return await pinnedFlags(env);

    const upload = await engineVersion(env);
    const upstreamUrl = `${CDN}/${upload}-RobloxWebClient/${encodeURI(relative)}`;
    const headers = new Headers();
    for (const h of ["if-none-match", "if-modified-since"]) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (upstream.status !== 200 && upstream.status !== 304) return notFound();

    const ext = relative.split(".").pop()?.toLowerCase() ?? "";
    const out: Record<string, string> = {
      "content-type": MIME[ext] || upstream.headers.get("content-type") || "application/octet-stream",
      "cache-control": "no-cache",
    };
    for (const h of ["etag", "last-modified"]) {
      const v = upstream.headers.get(h);
      if (v) out[h] = v;
    }
    return new Response(request.method === "HEAD" || upstream.status === 304 ? null : upstream.body, {
      status: upstream.status,
      headers: isolated(out),
    });
  } catch (err) {
    return new Response(`Engine fetch failed: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
      headers: isolated({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }),
    });
  }
}
