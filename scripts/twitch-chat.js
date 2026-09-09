import { TwitchTransport, escapeChat, outgoingText } from './twitch-transport.js';
const ID = 'tactical-stream-view';
let bridge, authorization;
const handled = new Set();
const chatClass = () => CONFIG.ChatMessage.documentClass;
const relay = () => game.settings.get(ID, 'twitchRelayUser');
const isRelay = () => game.user.isGM && relay() === game.user.id;

Hooks.once('init', () => {
  game.settings.register(ID, 'twitchRelayUser', {scope:'world',config:false,type:String,default:''});
  game.settings.register(ID, 'twitchClientId', {scope:'client',config:false,type:String,default:''});
});

function addControls() {
  const chat = document.querySelector('#chat');
  if (!chat || chat.querySelector('.tsv-twitch-controls')) return;
  const controls = document.createElement('div'); controls.className = 'tsv-twitch-controls';
  controls.style.cssText = 'padding:6px;border-top:1px solid #806642;font-size:12px';
  const hint = document.createElement('span'); hint.textContent = 'Twitch · Coalsan — /t message sends publicly';
  controls.append(hint);
  if (game.user.isGM) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Connect / Disconnect Twitch';
    button.addEventListener('click', configure); controls.append(button);
  }
  (chat.querySelector('.chat-controls') || chat).append(controls);
}
Hooks.once('ready', addControls);
Hooks.on('renderChatLog', addControls);

// A real Foundry document carries the request to the elected GM. Never trust a
// client-supplied socket user ID or send private messages / ordinary game chat.
Hooks.on('chatMessage', (_log, message) => {
  if (!/^\/t(?:\s|$)/i.test(message)) return;
  void submit(message.replace(/^\/t\s*/i, ''));
  return false;
});
async function submit(text) {
  try {
    outgoingText(game.user.name, text);
    const user = game.users.get(relay());
    if (!user?.active || !user.isGM) throw Error('A GM must connect Twitch before /t can be used.');
    await chatClass().create({content:`<p><strong>To Twitch · ${escapeChat(game.user.name)}</strong>: ${escapeChat(text)}</p>`,speaker:{alias:game.user.name},whisper:[],blind:false,flags:{[ID]:{twitch:{direction:'out',text,status:'pending'}}}});
  } catch (error) { ui.notifications.error(error.message); }
}
export function eligibleOutgoing(message, creatorId) {
  const flag = message.flags?.[ID]?.twitch;
  return flag?.direction === 'out' && flag.status === 'pending' && typeof flag.text === 'string'
    && !message.blind && !message.whisper?.length && message.author?.id === creatorId;
}
Hooks.on('createChatMessage', (message, _options, creatorId) => {
  if (!isRelay() || !eligibleOutgoing(message, creatorId) || handled.has(message.id)) return;
  handled.add(message.id);
  if (handled.size > 2000) handled.delete(handled.values().next().value);
  void relayOutgoing(message);
});
async function relayOutgoing(message) {
  let status = 'sent';
  try {
    if (!bridge?.ready) throw Error('Twitch is not connected.');
    await bridge.send(message.author.name, message.flags[ID].twitch.text);
  } catch { status = 'failed — reconnect Twitch or wait, then send a new /t message'; }
  await message.update({[`flags.${ID}.twitch.status`]:status}).catch(() => ui.notifications.warn('Could not update Twitch delivery status.'));
}
Hooks.on('renderChatMessageHTML', (message, html) => {
  const flag = message.flags?.[ID]?.twitch;
  if (!flag) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector('.tsv-twitch-delivery')) return;
  const label = document.createElement('small'); label.className = 'tsv-twitch-delivery';
  label.textContent = flag.direction === 'in' ? 'From Twitch · Coalsan' : `Twitch: ${flag.status}`;
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
  panel.style.cssText='position:fixed;right:20px;top:100px;z-index:10010;background:#101923;color:white;border:1px solid #857042;padding:20px;width:min(450px,90vw)';
  panel.innerHTML='<form><h2>Connect Coalsan to Foundry chat</h2><p>Viewers will appear in the shared chat log. Every player can use /t to reply publicly as Coalsan, prefixed with their Foundry name. Regular chat and private rolls are not sent.</p><label for="tsv-twitch-client">Public Twitch application Client ID</label><input id="tsv-twitch-client" required autocomplete="off" type="text"><p>Use a registered public Twitch app. No client secret is needed. Authorization lasts for this browser session; reconnect after token expiry.</p><p role="status" aria-live="polite"></p><a href="https://www.twitch.tv/activate" target="_blank" rel="noopener noreferrer">Open Twitch activation</a><button type="submit">Get authorization code</button><button type="button">Cancel</button></form>';
  const input=panel.querySelector('input'), status=panel.querySelector('[role="status"]'), submitButton=panel.querySelector('[type="submit"]');
  input.value=game.settings.get(ID,'twitchClientId');
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
        await chatClass().create({content:`<p><strong>Twitch · ${escapeChat(incoming.name)}</strong>: ${escapeChat(incoming.text)}</p>`,speaker:{alias:`Twitch · ${incoming.name}`},whisper:[],blind:false,flags:{[ID]:{twitch:{direction:'in',id:incoming.id}}}});
      }
    });
    try {
      const existing=game.users.get(relay());
      if(existing?.active && existing.id!==game.user.id) throw Error('Another GM is already the Twitch relay. Disconnect that relay first.');
      await game.settings.set(ID,'twitchClientId',input.value.trim());
      status.textContent='Requesting Twitch authorization…';
      await current.authorize(input.value,code=>{status.textContent=`Enter ${code} on the Twitch activation page and authorize chat read/write as Coalsan.`;},controller.signal);
      if(controller.signal.aborted || bridge!==current)return;
      await game.settings.set(ID,'twitchRelayUser',game.user.id);
      current.connect();authorization=null;
      panel.querySelector('[type="button"]').textContent='Close setup';
    } catch(error){current.stop();if(bridge===current)bridge=null;authorization=null;status.textContent=error.message;submitButton.disabled=false;}
  });
  document.body.append(panel);input.focus();
}
