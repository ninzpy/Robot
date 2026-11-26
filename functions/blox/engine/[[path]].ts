import { handleEngine } from "../../../src/engine";

export const onRequest = ({ request, env }: { request: Request; env: { ENGINE_VERSION?: string } }) =>
  handleEngine(request, env);
