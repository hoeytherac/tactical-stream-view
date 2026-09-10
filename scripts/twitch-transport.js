const SCOPES = 'user:read:chat user:write:chat';
export const escapeChat = text => String(text).replace(/[&<>"'@\[\]]/g, c => `&#${c.charCodeAt(0)};`);
export function outgoingText(name, text) {
  const clean = value => String(value).replace(/[\r\n\x00-\x1f]/g, ' ').trim();
  const result = `[${clean(name).slice(0, 60)}] ${clean(text)}`;
  if (!clean(text) || [...result].length > 500) throw Error('Twitch messages must contain text and fit within 500 characters, including your name.');
  return result;
}

// Tokens exist only in this browser's memory, never in world settings or messages.
export class TwitchTransport {
  constructor({ onMessage, onStatus, fetcher = globalThis.fetch.bind(globalThis), Socket = WebSocket }) {
    Object.assign(this, { onMessage, onStatus, fetcher, Socket });
    this.sockets = new Set(); this.seen = new Set(); this.stopped = false;
  }
  async request(url, options = {}) {
    const response = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw Error(`Twitch request failed (${response.status}). Reconnect or check the app configuration.`);
    return data;
  }
  async authorize(clientId, showCode, signal) {
    this.clientId = clientId.trim();
    if (!/^[a-zA-Z0-9]{10,80}$/.test(this.clientId)) throw Error('Enter the Client ID of your registered public Twitch application (not a client secret).');
    const device = await this.request('https://id.twitch.tv/oauth2/device', { method:'POST', body:new URLSearchParams({client_id:this.clientId, scopes:SCOPES}) });
    if (this.stopped || signal.aborted) throw Error('Authorization cancelled.');
    showCode(device.user_code);
    const expires = Date.now() + device.expires_in * 1000;
    let interval = Math.max(5, device.interval || 5) * 1000;
    while (!this.stopped && !signal.aborted && Date.now() < expires) {
      await new Promise(resolve => {
        const cancel = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, interval);
        signal.addEventListener('abort', cancel, {once:true});
      });
      if (this.stopped || signal.aborted) break;
      const response = await this.fetcher('https://id.twitch.tv/oauth2/token', { method:'POST', signal:AbortSignal.timeout(15000), body:new URLSearchParams({client_id:this.clientId, scopes:SCOPES, device_code:device.device_code, grant_type:'urn:ietf:params:oauth:grant-type:device_code'}) });
      const data = await response.json();
      if (response.ok) {
        if (this.stopped || signal.aborted) break;
        this.token = data.access_token;
        await this.validate();
        return;
      }
      if (data.message === 'slow_down') interval += 5000;
      else if (data.message !== 'authorization_pending') throw Error('Twitch authorization was denied or expired. Try again.');
    }
    throw Error('Twitch authorization cancelled or expired.');
  }
  async validate() {
    const data = await this.request('https://id.twitch.tv/oauth2/validate', {headers:{Authorization:`Bearer ${this.token}`}});
    if (data.client_id !== this.clientId || !SCOPES.split(' ').every(scope => data.scopes?.includes(scope))) throw Error('Twitch authorization is missing chat permissions.');
    this.userId = data.user_id;
    this.username = data.login;
  }
  async api(path, body) {
    return this.request(`https://api.twitch.tv/helix/${path}`, {method:body ? 'POST' : 'GET', headers:{Authorization:`Bearer ${this.token}`, 'Client-Id':this.clientId, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
  }
  connect() {
    this.openSocket('wss://eventsub.wss.twitch.tv/ws');
    this.validationTimer = setInterval(() => this.validate().catch(() => this.fail('Twitch authorization expired. Reconnect.')), 3600000);
  }
  openSocket(url, previous) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' || parsed.hostname !== 'eventsub.wss.twitch.tv') return this.fail('Invalid Twitch reconnect address.');
    const socket = new this.Socket(url); this.sockets.add(socket);
    let watchdog = setTimeout(() => this.fail('Twitch connection timed out. Reconnect.'), 20000);
    let keepalive = 20000;
    socket.onmessage = async ({data}) => {
      if (this.stopped) return;
      try {
        const message = JSON.parse(data), type = message.metadata?.message_type;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => this.fail('Twitch connection lost. Reconnect.'), keepalive);
        if (type === 'session_welcome') {
          keepalive = (message.payload.session.keepalive_timeout_seconds || 10) * 1000 + 5000;
          if (previous) { this.sockets.delete(previous); previous.close(); }
          else await this.api('eventsub/subscriptions', {type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:this.userId},transport:{method:'websocket',session_id:message.payload.session.id}});
          if (!this.stopped) { this.ready = true; this.onStatus('Connected to Twitch'); }
        } else if (type === 'session_reconnect') {
          this.openSocket(message.payload.session.reconnect_url, socket);
        } else if (type === 'revocation') this.fail('Twitch revoked the chat subscription. Reconnect.');
        else if (type === 'notification' && message.payload.subscription.type === 'channel.chat.message') {
          const event = message.payload.event;
          if (this.seen.has(event.message_id)) return;
          this.seen.add(event.message_id);
          if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
          await this.onMessage({id:event.message_id, name:event.chatter_user_name, text:event.message.text});
        }
      } catch { this.fail('Twitch chat connection failed. Reconnect to retry.'); }
    };
    socket.onclose = () => { clearTimeout(watchdog); if (this.sockets.delete(socket) && !this.stopped) this.fail('Twitch disconnected. Reconnect to resume.'); };
    socket.onerror = () => this.fail('Twitch WebSocket error. Check your connection.');
  }
  async send(name, text) {
    if (!this.ready || this.stopped) throw Error('Twitch is not connected.');
    const message = outgoingText(name, text);
    if (Date.now() - (this.lastSend || 0) < 1500) throw Error('Please wait a moment before sending another Twitch message.');
    this.lastSend = Date.now();
    const result = await this.api('chat/messages', {broadcaster_id:this.userId,sender_id:this.userId,message});
    if (!result.data?.[0]?.is_sent) throw Error('Twitch did not accept the message.');
    return result.data[0].message_id;
  }
  fail(message) { this.stop(); this.onStatus(message); }
  stop() {
    this.stopped = true; this.ready = false; this.token = null;
    clearInterval(this.validationTimer);
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
  }
}
