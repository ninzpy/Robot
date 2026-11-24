import EpoxyTransport from "@mercuryworkshop/epoxy-transport";
import { defaultConfig } from "@mercuryworkshop/scramjet";
import { config as controllerConfig, Controller } from "@mercuryworkshop/scramjet-controller";
import { installBloxSignIn } from "../integrations/scramjet/signin";

const PREFIX = "/proxy/";
const LOGIN_URL = "https://www.roblox.com/login";
const ALLOWED_HOST = /(^|\.)(roblox\.com|rbxcdn\.com|robloxlabs\.com|arkoselabs\.com|funcaptcha\.com)$/i;
const address = document.getElementById("address") as HTMLInputElement;
const form = document.getElementById("address-form") as HTMLFormElement;
const frameElement = document.getElementById("browser") as HTMLIFrameElement;
const status = document.getElementById("status")!;

function wispUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/wisp/`;
}

function normalizeTarget(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("Enter a Roblox URL.");
  const target = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  if (!ALLOWED_HOST.test(target.hostname)) {
    throw new Error("This sign-in browser is limited to Roblox and its CAPTCHA provider.");
  }
  return target.href;
}

async function start(): Promise<void> {
  const registration = await navigator.serviceWorker.register(`${PREFIX}sw.js`, { scope: PREFIX });
  await navigator.serviceWorker.ready;
  const serviceworker = navigator.serviceWorker.controller ?? registration.active;
  if (!serviceworker) throw new Error("Scramjet's service worker did not activate.");

  const controller = new Controller({
    serviceworker,
    transport: new EpoxyTransport({ wisp: wispUrl() }),
    config: {
      ...controllerConfig,
      prefix: `${PREFIX}~/sj/`,
      scramjetPath: `${PREFIX}scramjet/scramjet.js`,
      injectPath: `${PREFIX}controller/controller.inject.js`,
      wasmPath: `${PREFIX}scramjet/scramjet.wasm`,
    },
    scramjetConfig: defaultConfig,
  });
  await controller.wait();
  installBloxSignIn(controller, { base: location.href });

  const requested = new URL(location.href).searchParams.get("login") || LOGIN_URL;
  address.value = normalizeTarget(requested);
  const frame = controller.createFrame(frameElement);
  frame.go(address.value);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      address.value = normalizeTarget(address.value);
      frame.go(address.value);
      status.textContent = "Roblox sign-in is ready.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  status.textContent = "Roblox sign-in is ready. This browser only connects to Roblox and its CAPTCHA provider.";
}

start().catch((error: unknown) => {
  console.error("[blox] Scramjet sign-in browser failed:", error);
  status.textContent = `Couldn't start the sign-in browser: ${error instanceof Error ? error.message : String(error)}`;
});
