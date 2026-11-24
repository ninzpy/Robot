import { handleEngine, type EngineEnv } from "./engine";
import { handleWisp } from "./wisp";

interface Env extends EngineEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(null, { status: 307, headers: { location: `/blox/${url.search}`, "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/wisp/")) return handleWisp(request);
    if (url.pathname.startsWith("/blox/engine/")) return handleEngine(request, env);
    return env.ASSETS.fetch(request);
  },
};
