const MODULE_PATH = "/modules/tactical-stream-view/";
const moduleIndex = window.location.pathname.indexOf(MODULE_PATH);
const routePrefix = moduleIndex >= 0 ? window.location.pathname.slice(0, moduleIndex) : "";
const gameUrl = new URL(`${routePrefix}/game`, window.location.origin);
gameUrl.searchParams.set("tacticalStream", "1");
const joinUrl = new URL(`${routePrefix}/join`, window.location.origin);

const params = new URLSearchParams(window.location.search);
const userId = params.get("user") ?? "";
const userName = params.get("name") ?? "Stream";
let pendingPassword = decodeCredential(window.location.hash);
let attemptedLogin = false;
let loginWatchdog = null;

const status = document.querySelector("[data-status]");
const signIn = document.querySelector("[data-signin]");
const passwordInput = signIn.querySelector("[name='password']");
const userNameLabel = document.querySelector("[data-user-name]");
const resolution = document.querySelector("[data-resolution]");
const frame = document.querySelector("[data-foundry-session]");

userNameLabel.textContent = userName;
window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
showResolutionHint();

signIn.addEventListener("submit", event => {
  event.preventDefault();
  pendingPassword = passwordInput.value;
  attemptedLogin = false;
  signIn.hidden = true;
  setStatus("Signing in through Foundry…");
  submitToFoundry();
});

frame.addEventListener("load", handleFrameLoad);
frame.src = gameUrl.toString();

function handleFrameLoad() {
  window.clearTimeout(loginWatchdog);
  let currentUrl;
  try {
    currentUrl = new URL(frame.contentWindow.location.href);
  } catch (_error) {
    showManualSignIn("The Foundry sign-in page could not be opened inside this browser source.");
    return;
  }

  if (currentUrl.pathname === gameUrl.pathname || currentUrl.pathname.endsWith("/game")) {
    setStatus("Connected. Opening the broadcast layout…");
    window.location.replace(gameUrl.toString());
    return;
  }

  if (currentUrl.pathname === joinUrl.pathname || currentUrl.pathname.endsWith("/join")) {
    if (!userId) {
      showManualSignIn("No Stream user was included in this source URL. Re-copy it from the module settings.");
      return;
    }
    if (pendingPassword && !attemptedLogin) {
      submitToFoundry();
      return;
    }
    showManualSignIn(attemptedLogin
      ? "Foundry did not accept that login. Check the Stream password and try again."
      : "Enter the Stream password to connect this browser source.");
    return;
  }

  showManualSignIn("Foundry returned an unexpected page. Reload the source or copy a fresh URL from the module settings.");
}

function submitToFoundry() {
  const doc = frame.contentDocument;
  const joinForm = doc?.querySelector("#join-game-form");
  const userSelect = joinForm?.querySelector("select[name='userid']");
  const foundryPassword = joinForm?.querySelector("input[name='password']");
  const submit = joinForm?.querySelector("button[type='submit']");
  if (!joinForm || !userSelect || !foundryPassword || !submit) {
    showManualSignIn("Foundry’s sign-in form is not ready. Reload the browser source and try again.");
    return;
  }

  const hasUser = Array.from(userSelect.options).some(option => option.value === userId);
  if (!hasUser) {
    showManualSignIn(`The Foundry user “${userName}” no longer exists. Choose it again in the module settings.`);
    return;
  }

  attemptedLogin = true;
  userSelect.value = userId;
  userSelect.dispatchEvent(new Event("change", { bubbles: true }));
  foundryPassword.value = pendingPassword;
  foundryPassword.dispatchEvent(new Event("input", { bubbles: true }));
  setStatus(`Signing in as ${userName}…`);
  joinForm.requestSubmit(submit);

  loginWatchdog = window.setTimeout(() => {
    let stillOnJoin = false;
    try {
      stillOnJoin = new URL(frame.contentWindow.location.href).pathname.endsWith("/join");
    } catch (_error) {
      stillOnJoin = true;
    }
    if (stillOnJoin) {
      pendingPassword = "";
      attemptedLogin = false;
      showManualSignIn("Foundry did not accept that login. Check the Stream password and try again.");
    }
  }, 6_000);
}

function showManualSignIn(message) {
  setStatus(message);
  signIn.hidden = false;
  passwordInput.value = "";
  passwordInput.focus();
}

function setStatus(message) {
  status.textContent = message;
}

function decodeCredential(hash) {
  try {
    const token = new URLSearchParams(hash.replace(/^#/, "")).get("login");
    if (!token) return "";
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(token.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return String(JSON.parse(new TextDecoder().decode(bytes)).password ?? "");
  } catch (_error) {
    return "";
  }
}

function showResolutionHint() {
  const squareDifference = Math.abs(window.innerWidth - window.innerHeight);
  if (window.innerWidth >= 1024 && window.innerHeight >= 768 && squareDifference <= 80) return;
  resolution.hidden = false;
  resolution.textContent = `This browser source is ${window.innerWidth} × ${window.innerHeight}. Set it to 1080 × 1080 in Meld for the intended readable square layout.`;
}
