import { TwitchTransport, escapeChat, outgoingText } from './twitch-transport.js';
import { summarizeRoll, summaryDelta } from './roll-relay.js';
const ID = 'tactical-stream-view';
const DEFAULT_CLIENT_ID = 'lhgo8hw84mx54kzn3b4f2895vjevga';
let bridge, authorization;
const handled = new Set();
const cardStates = new Map();
function rollOptions() {
  return {challengeVisibility: game.system.id === 'dnd5e' ? game.settings.get('dnd5e','challengeVisibility') : 'none',
    midi: game.modules.get('midi-qol')?.active ? (game.settings.get('midi-qol','ConfigSettings') ?? {}) : {gmAttackDisplay:'full',gmDamageDisplay:'full',autoCheckSaves:'all',highlightSuccess:true}};
}
function relayCard(message) {
  try {
    const next = summarizeRoll(message, rollOptions());
    const previous = cardStates.get(message.id);
    cardStates.set(message.id,next);
    if(cardStates.size > 2000) cardStates.delete(cardStates.keys().next().value);
    const delta = summaryDelta(previous,next);
    if (!delta) return;
    void enqueueSend(bridge,()=>{
      const live = game.messages.get(message.id);
      const current = live && summarizeRoll(live,rollOptions());
      // Do not send a stale snapshot after privacy or results change.
      if (!current || !delta.text.split(' \u2014 ').every(p=>current.text.split(' \u2014 ').includes(p))) return null;
      return delta;
    }).catch(()=>ui.notifications.warn('A roll update could not be sent to Twitch.'));
  } catch { ui.notifications.warn('Unsupported roll update skipped by Twitch relay.'); }
}
Hooks.on('preUpdateChatMessage', message => {
  if (!isRelay() || !bridge?.ready || cardStates.has(message.id)) return;
  try {cardStates.set(message.id,summarizeRoll(message,rollOptions()));} catch {}
});
Hooks.on('updateChatMessage', message => {
  if (isRelay() && bridge?.ready && cardStates.has(message.id)) relayCard(message);
});
Hooks.on('deleteChatMessage', message => cardStates.delete(message.id));
let sendChain = Promise.resolve();
let lastSend = 0;
function enqueueSend(current, getSummary) {
  const expires = Date.now() + 60000;
  const result = sendChain.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1700 - (Date.now() - lastSend))));
    if (Date.now() > expires || bridge !== current || !current?.ready || !isRelay()) throw Error('Twitch disconnected or queued message expired.');
    const summary = getSummary(); // Recheck privacy immediately before transmission.
    if (!summary) return;
    lastSend = Date.now();
    await current.send(summary.name, summary.text);
  });
  sendChain = result.catch(() => {});
  return result;
}
const chatClass = () => CONFIG.ChatMessage.documentClass;
const relay = () => game.settings.get(ID, 'twitchRelayUser');
const isRelay = () => game.user.isGM && relay() === game.user.id;

Hooks.once('init', () => {
  game.settings.register(ID, 'twitchRelayUser', {scope:'world',config:false,type:String,default:''});
  game.settings.register(ID, 'twitchClientId', {scope:'client',config:false,type:String,default:DEFAULT_CLIENT_ID});
});

function addControls() {
  const chat = document.querySelector('#chat');
  if (!chat || chat.querySelector('.tsv-twitch-controls')) return;
  const controls = document.createElement('div'); controls.className = 'tsv-twitch-controls';
  controls.style.cssText = 'padding:6px;border-top:1px solid #806642;font-size:12px;pointer-events:auto;position:relative;flex-shrink:0';
  const hint = document.createElement('span'); hint.textContent = 'Twitch \u00b7 Public rolls auto-share while connected \u00b7 !t to talk';
  controls.append(hint);
  // A separate explicit composer avoids Foundry rejecting unknown slash commands.
  const composer = document.createElement('div');
  composer.style.cssText = 'display:flex;gap:4px;pointer-events:auto;margin-top:6px';
  const input = document.createElement('input'); input.type = 'text';
  input.placeholder = 'Message Twitch'; input.setAttribute('aria-label','Message Twitch');
  input.style.cssText = 'flex:1;min-width:0;pointer-events:auto';
  const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Send';
  send.style.cssText = 'width:auto;pointer-events:auto';
  const sendText = async () => {
    if (send.disabled || !input.value.trim()) return;
    const text = input.value.trim(); send.disabled = true; input.disabled = true;
    try { if (await submit(text)) input.value = ''; }
    finally {send.disabled = false;input.disabled = false;input.focus();}
  };
  send.addEventListener('click', event => {event.preventDefault();event.stopPropagation();void sendText();});
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if(event.key === 'Enter' && !event.isComposing){event.preventDefault();void sendText();}
  });
  composer.append(input,send); controls.append(composer);
  if (game.user.isGM) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Connect / Disconnect Twitch';
    button.style.cssText = 'pointer-events:auto;position:relative;min-height:32px;width:100%';
    button.addEventListener('click', event => {event.preventDefault();event.stopPropagation();configure();}); controls.append(button);
  }
  (chat.querySelector('.chat-controls') || chat).append(controls);
}
Hooks.once('ready', addControls);
Hooks.on('renderChatLog', addControls);

// A real Foundry document carries the request to the elected GM. Never trust a
// client-supplied socket user ID or send private messages / ordinary game chat.
Hooks.on('chatMessage', (_log, message) => {
  if (!/^!t(?:\s|$)/i.test(message)) return;
  void submit(message.replace(/^!t\s*/i, ''));
  return false;
});
async function submit(text) {
  try {
    outgoingText(game.user.name, text);
    const user = game.users.get(relay());
    if (!user?.active || !user.isGM) throw Error('A GM must connect Twitch before !t can be used.');
    await chatClass().create({content:`<p><strong>To Twitch \u00b7 ${escapeChat(game.user.name)}</strong>: ${escapeChat(text)}</p>`,speaker:{alias:game.user.name},whisper:[],blind:false,flags:{[ID]:{twitch:{direction:'out',text,status:'pending'}}}});
    return true;
  } catch (error) { ui.notifications.error(error.message); return false; }
}
export function eligibleOutgoing(message, creatorId) {
  const flag = message.flags?.[ID]?.twitch;
  return flag?.direction === 'out' && flag.status === 'pending' && typeof flag.text === 'string'
    && !message.blind && !message.whisper?.length && message.author?.id === creatorId;
}
Hooks.on('createChatMessage', (message, _options, creatorId) => {
  if (!isRelay() || !bridge?.ready || handled.has(message.id)) return;
  if (!eligibleOutgoing(message, creatorId)) {
    relayCard(message);
    return;
  }
  handled.add(message.id);
  if (handled.size > 2000) handled.delete(handled.values().next().value);
  void relayOutgoing(message);
});
async function relayOutgoing(message) {
  let status = 'sent';
  try {
    if (!bridge?.ready) throw Error('Twitch is not connected.');
    await enqueueSend(bridge, () => eligibleOutgoing(message, message.author.id) ? {name:message.author.name,text:message.flags[ID].twitch.text} : null);
  } catch { status = 'failed \u2014 reconnect Twitch or wait, then send a new !t message'; }
  await message.update({[`flags.${ID}.twitch.status`]:status}).catch(() => ui.notifications.warn('Could not update Twitch delivery status.'));
}
Hooks.on('renderChatMessageHTML', (message, html) => {
  const flag = message.flags?.[ID]?.twitch;
  if (!flag) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector('.tsv-twitch-delivery')) return;
  const label = document.createElement('small'); label.className = 'tsv-twitch-delivery';
  label.textContent = flag.direction === 'in' ? 'From Twitch' : `Twitch: ${flag.status}`;
  root.append(label);
});

function configure() {
  if (!game.user.isGM) return;
  if (bridge || authorization) {
    authorization?.abort(); authorization = null; bridge?.stop(); bridge = null;
    if (isRelay()) void game.settings.set(ID, 'twitchRelayUser', '');
    ui.notifications.info('Twitch disconnected.'); return;
  }
  if (document.getElementById('tsv-twitch-authorize')) return;
  const panel = document.createElement('section'); panel.id = 'tsv-twitch-authorize';
  panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Connect Twitch chat');
  panel.style.cssText='position:fixed;right:20px;top:100px;z-index:10010;background:#101923;color:white;border:1px solid #857042;padding:20px;width:min(450px,90vw);pointer-events:auto;max-height:80vh;overflow:auto';
  panel.innerHTML='<form><h2>Connect Twitch Chat</h2><p>Viewers will appear in the shared chat log. Every player can use !t to reply publicly, prefixed with their Foundry name. Regular chat and private rolls are not sent.</p><label for="tsv-twitch-client">Public Twitch application Client ID</label><input id="tsv-twitch-client" required autocomplete="off" type="text"><p>Use a registered public Twitch app. No client secret is needed. Authorization lasts for this browser session; reconnect after token expiry.</p><p role="status" aria-live="polite"></p><a href="https://www.twitch.tv/activate" target="_blank" rel="noopener noreferrer">Open Twitch activation</a><button type="submit">Get authorization code</button><button type="button">Cancel</button></form>';
  panel.querySelector('p').textContent = 'While connected, new public rolls and item/spell/feature usage summaries automatically go to Twitch. Whispers and blind rolls are excluded. Hidden DCs are omitted. Players use !t to talk with their name prefixed. Regular chat is not sent.';
  const input=panel.querySelector('input'), status=panel.querySelector('[role="status"]'), submitButton=panel.querySelector('[type="submit"]');
  input.value=game.settings.get(ID,'twitchClientId') || DEFAULT_CLIENT_ID;
  panel.querySelector('[type="button"]').addEventListener('click',()=>{
    if(!bridge?.ready){authorization?.abort();authorization=null;bridge?.stop();bridge=null;}
    panel.remove();
  });
  panel.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();if(submitButton.disabled)return;submitButton.disabled=true;
    const controller=authorization=new AbortController();
    const current=bridge=new TwitchTransport({
      onStatus: text => {status.textContent=text; if(!panel.isConnected) ui.notifications.info(text);},
      onMessage: async incoming => {
        if (!isRelay() || bridge !== current) return;
        await chatClass().create({content:`<p><strong>Twitch \u00b7 ${escapeChat(incoming.name)}</strong>: ${escapeChat(incoming.text)}</p>`,speaker:{alias:`Twitch \u00b7 ${incoming.name}`},whisper:[],blind:false,flags:{[ID]:{twitch:{direction:'in',id:incoming.id}}}});
      }
    });
    try {
      const existing=game.users.get(relay());
      if(existing?.active && existing.id!==game.user.id) throw Error('Another GM is already the Twitch relay. Disconnect that relay first.');
      await game.settings.set(ID,'twitchClientId',input.value.trim());
      status.textContent='Requesting Twitch authorization\u2026';
      await current.authorize(input.value,code=>{status.textContent=`Enter ${code} on the Twitch activation page and authorize chat read/write.`;},controller.signal);
      if(controller.signal.aborted || bridge!==current)return;
      await game.settings.set(ID,'twitchRelayUser',game.user.id);
      current.connect();authorization=null;
      panel.querySelector('[type="button"]').textContent='Close setup';
    } catch(error){current.stop();if(bridge===current)bridge=null;authorization=null;status.textContent=error.message;submitButton.disabled=false;}
  });
  document.body.append(panel);input.focus();
}
