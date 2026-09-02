const MODULE_ID = "tactical-stream-view";
const SOCKET_NAME = `module.${MODULE_ID}`;
const STREAM_QUERY_KEY = "tacticalStream";
const HEARTBEAT_INTERVAL = 10_000;
const HEARTBEAT_TIMEOUT = 25_000;

const state = {
  isStreamClient: false,
  viewerHeartbeats: new Map(),
  shell: null,
  chatList: null,
  diceObserver: null,
  heartbeatTimer: null,
  lastCameraSentAt: 0,
  lastLocalCamera: null,
  pendingCamera: null,
  cameraTimer: null
};

const appv1 = globalThis.foundry?.appv1?.api;
const FormApplicationBase = globalThis.FormApplication ?? appv1?.FormApplication;

class StreamConnectionConfig extends FormApplicationBase {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tactical-stream-view-config",
      title: "Tactical Stream View · Stream Connection",
      template: `modules/${MODULE_ID}/templates/stream-connection.hbs`,
      width: 620,
      height: "auto",
      closeOnSubmit: false,
      submitOnChange: false,
      classes: ["tactical-stream-config-window"]
    });
  }

  getData() {
    const streamUserId = setting("streamUserId");
    return {
      streamUserId,
      users: game.users.contents.map(user => ({
        id: user.id,
        name: user.name,
        isGM: user.isGM,
        selected: user.id === streamUserId
      })),
      sourceUrl: buildStreamUrl(),
      viewerConnected: isViewerConnected(streamUserId),
      streamTitle: setting("streamTitle"),
      accentColor: normalizeHex(setting("accentColor")),
      maxChatCards: setting("maxChatCards"),
      followGmCamera: setting("followGmCamera")
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;
    root?.querySelector('[data-action="copy-url"]')?.addEventListener("click", copyStreamUrl);
    root?.querySelector('[data-action="test-viewer"]')?.addEventListener("click", requestViewerStatus);

    const picker = root?.querySelector("#tsv-accent-picker");
    const text = root?.querySelector("#tsv-accent");
    picker?.addEventListener("input", () => {
      text.value = picker.value;
    });
    text?.addEventListener("input", () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
    });
  }

  async _updateObject(_event, formData) {
    const maxChatCards = clampNumber(formData.maxChatCards, 3, 16, 7);
    const accentColor = normalizeHex(formData.accentColor);
    const updates = {
      streamUserId: String(formData.streamUserId ?? ""),
      streamTitle: String(formData.streamTitle ?? "Tactical View").trim().slice(0, 60) || "Tactical View",
      accentColor,
      maxChatCards,
      followGmCamera: Boolean(formData.followGmCamera)
    };

    await Promise.all(Object.entries(updates).map(([key, value]) => game.settings.set(MODULE_ID, key, value)));
    game.socket.emit(SOCKET_NAME, { type: "settings-refresh" });
    ui.notifications.info(localize("TSV.Settings.Saved"));
    this.render(false);
  }
}

Hooks.once("init", () => {
  registerSettings();
  registerSceneControls();
  registerChatHooks();
  registerCanvasHooks();
});

Hooks.once("ready", async () => {
  registerSocket();
  state.isStreamClient = shouldUseStreamLayout();

  if (state.isStreamClient) {
    await activateStreamClient();
  } else if (game.user.isGM) {
    pruneHeartbeats();
  }
});

Hooks.once("diceSoNiceReady", () => {
  if (!state.isStreamClient) return;
  window.setTimeout(prepareDiceStage, 50);
});

function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "streamConnection", {
    name: "TSV.Settings.MenuName",
    label: "TSV.Settings.MenuLabel",
    hint: "TSV.Settings.MenuHint",
    icon: "fa-solid fa-tower-broadcast",
    type: StreamConnectionConfig,
    restricted: true
  });

  registerSetting("streamUserId", String, "", false);
  registerSetting("broadcastEnabled", Boolean, false, false, applyBroadcastState);
  registerSetting("followGmCamera", Boolean, true, false);
  registerSetting("streamTitle", String, "TACTICAL VIEW", false, refreshStreamLayout);
  registerSetting("accentColor", String, "#2f9dff", false, refreshStreamLayout);
  registerSetting("maxChatCards", Number, 7, false, trimChatCards);
}

function registerSetting(key, type, defaultValue, config, onChange) {
  game.settings.register(MODULE_ID, key, {
    name: key,
    scope: "world",
    config,
    type,
    default: defaultValue,
    onChange
  });
}

function registerSceneControls() {
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;

    const tools = {
      broadcast: {
        name: "broadcast",
        title: "TSV.Controls.Broadcast",
        icon: "fa-solid fa-satellite-dish",
        order: 0,
        toggle: true,
        active: setting("broadcastEnabled"),
        onChange: async (_event, active) => setBroadcastEnabled(active)
      },
      follow: {
        name: "follow",
        title: "TSV.Controls.Follow",
        icon: "fa-solid fa-crosshairs",
        order: 1,
        toggle: true,
        active: setting("followGmCamera"),
        onChange: async (_event, active) => {
          await game.settings.set(MODULE_ID, "followGmCamera", active);
          if (active && setting("broadcastEnabled")) pushCurrentCamera();
        }
      },
      pushView: {
        name: "pushView",
        title: "TSV.Controls.PushView",
        icon: "fa-solid fa-arrows-to-eye",
        order: 2,
        button: true,
        onChange: pushCurrentCamera
      },
      copyUrl: {
        name: "copyUrl",
        title: "TSV.Controls.CopyUrl",
        icon: "fa-regular fa-copy",
        order: 3,
        button: true,
        onChange: copyStreamUrl
      },
      configure: {
        name: "configure",
        title: "TSV.Controls.Configure",
        icon: "fa-solid fa-sliders",
        order: 4,
        button: true,
        onChange: () => new StreamConnectionConfig().render(true)
      }
    };

    const control = {
      name: "tacticalStream",
      title: "TSV.Controls.Title",
      icon: "fa-solid fa-tower-broadcast",
      order: 95,
      visible: true,
      activeTool: "broadcast",
      tools
    };

    if (Array.isArray(controls)) {
      control.tools = Object.values(tools);
      controls.push(control);
    } else {
      controls.tacticalStream = control;
    }
  });
}

function registerChatHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!state.isStreamClient) return;
    addChatCard(message, html);
  });

  // Compatibility with systems still dispatching the pre-V13 hook.
  Hooks.on("renderChatMessage", (message, html) => {
    if (!state.isStreamClient) return;
    addChatCard(message, html);
  });

  Hooks.on("deleteChatMessage", message => {
    state.chatList?.querySelector(`[data-message-id="${cssEscape(message.id)}"]`)?.remove();
  });

  Hooks.on("updateChatMessage", message => {
    if (!state.isStreamClient) return;
    renderMessageElement(message).then(element => addChatCard(message, element)).catch(logError);
  });
}

function registerCanvasHooks() {
  Hooks.on("canvasReady", () => {
    if (state.isStreamClient) {
      refreshSceneLabel();
      window.setTimeout(() => {
        prepareDiceStage();
        if (state.pendingCamera) applyCamera(state.pendingCamera);
      }, 100);
    } else if (game.user?.isGM && setting("broadcastEnabled")) {
      pushCurrentCamera();
    }
  });

  Hooks.on("canvasPan", (_canvas, position) => {
    state.lastLocalCamera = position;
    if (!game.user?.isGM || state.isStreamClient) return;
    if (!setting("broadcastEnabled") || !setting("followGmCamera")) return;
    queueCameraBroadcast(position);
  });
}

function registerSocket() {
  game.socket.on(SOCKET_NAME, payload => {
    if (!payload || typeof payload !== "object") return;

    switch (payload.type) {
      case "broadcast-state":
        if (state.isStreamClient) applyBroadcastState(payload.enabled);
        break;
      case "camera":
        if (state.isStreamClient) applyCamera(payload);
        break;
      case "viewer-heartbeat":
        if (game.user.isGM) recordViewerHeartbeat(payload);
        break;
      case "viewer-status-request":
        if (state.isStreamClient) sendViewerHeartbeat();
        break;
      case "settings-refresh":
        if (state.isStreamClient) refreshStreamLayout();
        break;
      default:
        break;
    }
  });
}

async function activateStreamClient() {
  document.body.classList.add("tsv-stream-client");
  document.body.dataset.tsvUser = game.user.id;
  createStreamShell();
  applyBroadcastState(setting("broadcastEnabled"));
  refreshStreamLayout();
  await seedChatCards();
  prepareDiceStage();
  observeDiceCanvas();
  startViewerHeartbeat();

  // Foundry and Dice So Nice both use resize listeners to fit their renderers.
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 150);
}

function createStreamShell() {
  document.getElementById("tactical-stream-shell")?.remove();

  const shell = document.createElement("main");
  shell.id = "tactical-stream-shell";
  shell.setAttribute("aria-label", "Tactical stream composition");
  shell.innerHTML = `
    <header class="tsv-broadcast-header">
      <div class="tsv-brand-block">
        <span class="tsv-brand-rule" aria-hidden="true"></span>
        <div>
          <p class="tsv-eyebrow">LIVE TABLETOP</p>
          <h1 class="tsv-stream-title"></h1>
        </div>
      </div>
      <div class="tsv-scene-block">
        <span class="tsv-scene-label"></span>
        <span class="tsv-live-pill"><i></i><b>LIVE</b></span>
      </div>
    </header>

    <section class="tsv-canvas-frame" aria-label="Tactical canvas">
      <div class="tsv-panel-label"><span>TACTICAL VIEW</span></div>
      <div class="tsv-corner tsv-corner-nw"></div>
      <div class="tsv-corner tsv-corner-ne"></div>
      <div class="tsv-corner tsv-corner-sw"></div>
      <div class="tsv-corner tsv-corner-se"></div>
    </section>

    <section class="tsv-dice-frame" aria-label="Dice So Nice roll stage">
      <div class="tsv-panel-label"><span>DICE STAGE</span></div>
      <div class="tsv-dice-placeholder">
        <i class="fa-solid fa-dice-d20" aria-hidden="true"></i>
        <span>Dice So Nice rolls appear here</span>
      </div>
    </section>

    <aside class="tsv-chat-rail living-journal" aria-label="Living Journal chat">
      <header class="tsv-journal-header">
        <div class="tsv-journal-ornament" aria-hidden="true">◆</div>
        <div>
          <p>THE LIVING JOURNAL</p>
          <h2>Recent Rolls &amp; Tales</h2>
        </div>
        <div class="tsv-journal-ornament" aria-hidden="true">◆</div>
      </header>
      <ol class="tsv-chat-list" aria-live="polite" aria-relevant="additions"></ol>
      <div class="tsv-journal-footer" aria-hidden="true"><span></span><i>✦</i><span></span></div>
    </aside>

    <section class="tsv-standby" aria-live="polite">
      <div class="tsv-standby-glyph"><i class="fa-solid fa-tower-broadcast"></i></div>
      <p>TACTICAL STREAM</p>
      <h2>Standing by</h2>
      <span>Use “Push Stream Mode” in Foundry when the table is ready.</span>
    </section>`;

  document.body.append(shell);
  state.shell = shell;
  state.chatList = shell.querySelector(".tsv-chat-list");
  refreshSceneLabel();
}

function refreshStreamLayout() {
  if (!state.isStreamClient || !state.shell) return;
  document.documentElement.style.setProperty("--tsv-accent", normalizeHex(setting("accentColor")));
  const title = state.shell.querySelector(".tsv-stream-title");
  if (title) title.textContent = setting("streamTitle");
  refreshSceneLabel();
  trimChatCards();
}

function refreshSceneLabel() {
  const label = state.shell?.querySelector(".tsv-scene-label");
  if (label) label.textContent = canvas?.scene?.name ?? game.world?.title ?? "Foundry VTT";
}

function applyBroadcastState(enabled = setting("broadcastEnabled")) {
  if (!state.isStreamClient) return;
  const live = Boolean(enabled);
  document.body.classList.toggle("tsv-broadcast-live", live);
  state.shell?.classList.toggle("is-live", live);
  const pill = state.shell?.querySelector(".tsv-live-pill b");
  if (pill) pill.textContent = live ? "LIVE" : "STANDBY";
}

async function setBroadcastEnabled(enabled) {
  const live = Boolean(enabled);
  await game.settings.set(MODULE_ID, "broadcastEnabled", live);
  game.socket.emit(SOCKET_NAME, { type: "broadcast-state", enabled: live });
  ui.notifications.info(localize(live ? "TSV.Notifications.BroadcastOn" : "TSV.Notifications.BroadcastOff"));
  if (live) pushCurrentCamera();
}

function pushCurrentCamera() {
  if (!game.user?.isGM || !canvas?.ready) return;
  const position = state.lastLocalCamera ?? {
    x: canvas.stage?.pivot?.x,
    y: canvas.stage?.pivot?.y,
    scale: canvas.stage?.scale?.x
  };
  broadcastCamera(position);
  ui.notifications.info(localize("TSV.Notifications.ViewPushed"));
}

function queueCameraBroadcast(position) {
  state.pendingCamera = position;
  const now = Date.now();
  const elapsed = now - state.lastCameraSentAt;
  if (elapsed >= 90) {
    broadcastCamera(position);
    return;
  }
  if (state.cameraTimer) return;
  state.cameraTimer = window.setTimeout(() => {
    state.cameraTimer = null;
    broadcastCamera(state.pendingCamera);
  }, 90 - elapsed);
}

function broadcastCamera(position) {
  if (!position || !canvas?.scene) return;
  const payload = {
    type: "camera",
    sceneId: canvas.scene.id,
    x: Number(position.x),
    y: Number(position.y),
    scale: Number(position.scale ?? position.zoom ?? canvas.stage?.scale?.x ?? 1),
    duration: 90
  };
  if (![payload.x, payload.y, payload.scale].every(Number.isFinite)) return;
  state.lastCameraSentAt = Date.now();
  game.socket.emit(SOCKET_NAME, payload);
}

async function applyCamera(payload) {
  if (!state.isStreamClient || !payload) return;
  state.pendingCamera = payload;
  if (!setting("broadcastEnabled") || !setting("followGmCamera")) return;
  if (!canvas?.ready || payload.sceneId !== canvas.scene?.id) return;

  const adjusted = adjustCameraForComposition(payload);
  try {
    await canvas.animatePan({
      x: adjusted.x,
      y: adjusted.y,
      scale: adjusted.scale,
      duration: clampNumber(payload.duration, 0, 400, 90)
    });
  } catch (error) {
    logError(error);
  }
}

function adjustCameraForComposition(payload) {
  const frame = state.shell?.querySelector(".tsv-canvas-frame")?.getBoundingClientRect();
  if (!frame) return payload;
  const scale = Math.max(0.1, Number(payload.scale) || 1);
  const frameCenterX = frame.left + frame.width / 2;
  const frameCenterY = frame.top + frame.height / 2;
  return {
    x: Number(payload.x) + (window.innerWidth / 2 - frameCenterX) / scale,
    y: Number(payload.y) + (window.innerHeight / 2 - frameCenterY) / scale,
    scale
  };
}

async function seedChatCards() {
  if (!state.chatList) return;
  const max = clampNumber(setting("maxChatCards"), 3, 16, 7);
  const visibleMessages = game.messages.contents.filter(message => message.visible !== false).slice(-max);
  for (const message of visibleMessages) {
    try {
      const element = await renderMessageElement(message);
      addChatCard(message, element, false);
    } catch (error) {
      logError(error);
    }
  }
  scrollChatToBottom(false);
}

async function renderMessageElement(message) {
  const ChatLog = foundry.applications?.sidebar?.tabs?.ChatLog;
  if (ChatLog?.renderMessage) return ChatLog.renderMessage(message);
  if (typeof message.renderHTML === "function") return message.renderHTML();
  if (typeof message.getHTML === "function") return message.getHTML();
  throw new Error("No compatible Foundry chat renderer was found.");
}

function addChatCard(message, html, animate = true) {
  if (!state.chatList || !message || message.visible === false) return;
  const source = unwrapElement(html);
  if (!source) return;

  const clone = source.cloneNode(true);
  clone.removeAttribute("id");
  clone.classList.add("tsv-journal-card", "living-journal-card");
  clone.dataset.messageId = message.id;
  clone.setAttribute("role", "listitem");

  clone.querySelectorAll(".message-delete, .message-edit, .message-popout, .message-visibility, [data-action='delete'], [data-action='edit']")
    .forEach(element => element.remove());
  clone.querySelectorAll("button, input, select, textarea, a").forEach(element => {
    element.tabIndex = -1;
    element.setAttribute("aria-disabled", "true");
  });

  const oldCard = state.chatList.querySelector(`[data-message-id="${cssEscape(message.id)}"]`);
  if (oldCard) oldCard.replaceWith(clone);
  else state.chatList.append(clone);

  if (animate && !oldCard) {
    clone.animate(
      [
        { opacity: 0, transform: "translateY(16px) scale(.985)" },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ],
      { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
  }

  trimChatCards();
  scrollChatToBottom(animate);
}

function trimChatCards() {
  if (!state.chatList) return;
  const max = clampNumber(setting("maxChatCards"), 3, 16, 7);
  while (state.chatList.children.length > max) state.chatList.firstElementChild?.remove();
}

function scrollChatToBottom(smooth = true) {
  requestAnimationFrame(() => {
    state.chatList?.scrollTo({ top: state.chatList.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

function prepareDiceStage() {
  if (!state.isStreamClient) return;
  const diceCanvas = document.getElementById("dice-box-canvas");
  state.shell?.classList.toggle("has-dice-so-nice", Boolean(diceCanvas));
  if (!diceCanvas) return;
  diceCanvas.classList.add("tsv-captured-dice-canvas");
  window.dispatchEvent(new Event("resize"));
}

function observeDiceCanvas() {
  state.diceObserver?.disconnect();
  state.diceObserver = new MutationObserver(() => {
    if (document.getElementById("dice-box-canvas")) prepareDiceStage();
  });
  state.diceObserver.observe(document.body, { childList: true, subtree: true });
}

function startViewerHeartbeat() {
  sendViewerHeartbeat();
  window.clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = window.setInterval(sendViewerHeartbeat, HEARTBEAT_INTERVAL);
}

function sendViewerHeartbeat() {
  if (!state.isStreamClient) return;
  game.socket.emit(SOCKET_NAME, {
    type: "viewer-heartbeat",
    userId: game.user.id,
    sceneId: canvas?.scene?.id ?? null,
    at: Date.now()
  });
}

function requestViewerStatus() {
  game.socket.emit(SOCKET_NAME, { type: "viewer-status-request" });
  window.setTimeout(updateOpenConnectionWindows, 500);
}

function recordViewerHeartbeat(payload) {
  if (!payload.userId) return;
  state.viewerHeartbeats.set(payload.userId, Date.now());
  updateOpenConnectionWindows();
}

function pruneHeartbeats() {
  const cutoff = Date.now() - HEARTBEAT_TIMEOUT;
  for (const [userId, at] of state.viewerHeartbeats) {
    if (at < cutoff) state.viewerHeartbeats.delete(userId);
  }
}

function isViewerConnected(userId) {
  pruneHeartbeats();
  return Boolean(userId && state.viewerHeartbeats.has(userId));
}

function updateOpenConnectionWindows() {
  const userId = setting("streamUserId");
  const connected = isViewerConnected(userId);
  for (const app of Object.values(ui.windows ?? {})) {
    if (!(app instanceof StreamConnectionConfig)) continue;
    const root = app.element?.[0] ?? app.element;
    const status = root?.querySelector?.("[data-viewer-state]");
    if (!status) continue;
    status.classList.toggle("is-connected", connected);
    status.classList.toggle("is-offline", !connected);
    const label = status.querySelector("span:nth-of-type(2)");
    if (label) label.textContent = connected ? "Stream viewer connected" : "Stream viewer not connected yet";
  }
}

function shouldUseStreamLayout() {
  const selectedUserId = setting("streamUserId");
  const url = new URL(window.location.href);
  const forced = url.searchParams.get(STREAM_QUERY_KEY) === "1" || url.hash.includes("tactical-stream");
  if (selectedUserId) return game.user.id === selectedUserId;
  return forced;
}

function buildStreamUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.set(STREAM_QUERY_KEY, "1");
  return url.toString();
}

async function copyStreamUrl() {
  const url = buildStreamUrl();
  try {
    await navigator.clipboard.writeText(url);
  } catch (_error) {
    const input = document.createElement("textarea");
    input.value = url;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  ui.notifications.info(localize("TSV.Notifications.UrlCopied"));
}

function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

function localize(key) {
  return game.i18n.localize(key);
}

function normalizeHex(value) {
  const candidate = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : "#2f9dff";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function unwrapElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html instanceof DocumentFragment) return html.firstElementChild;
  return null;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function logError(error) {
  console.error(`${MODULE_ID} |`, error);
}
