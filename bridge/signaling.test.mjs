import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('Connect Meld opens an inline form, rejects invalid URL, and closes on Cancel', async () => {
  const source = readFileSync(new URL('../scripts/single-tab-stream.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');
  const elements = [];
  class Element {
    style = {}; handlers = {}; children = {}; value = '';
    setAttribute() {} focus() {}
    addEventListener(type, handler) { this.handlers[type] = handler; }
    querySelector(selector) { return this.children[selector] ||= new Element(); }
    remove() { elements.splice(elements.indexOf(this), 1); }
  }
  const context = vm.createContext({
    URL, console,
    game: { modules: { get: () => ({}) } },
    Hooks: { once: (_event, ready) => ready() },
    document: {
      createElement: () => new Element(),
      getElementById: id => elements.find(e => e.id === id),
      body: { append: e => elements.push(e) }
    }
    // No window.prompt exists in this environment: the UI must not depend on it.
  });
  vm.runInContext(source, context);
  const button = elements[0];
  await button.handlers.click();
  assert.equal(elements.length, 2);
  const panel = elements[1];
  assert.equal(panel.id, 'tactical-stream-pairing');
  await button.handlers.click();
  assert.equal(elements.length, 2, 'repeated clicks must not duplicate the form');
  panel.querySelector('input').value = 'not a URL';
  await panel.querySelector('form').handlers.submit({ preventDefault() {} });
  assert.match(panel.querySelector('[role="status"]').textContent, /full local helper URL/);
  assert.equal(panel.querySelector('[type="submit"]').disabled, false);
  panel.querySelector('[type="button"]').handlers.click();
  assert.equal(elements.length, 1);
});

test('receiver queues ICE before offer and includes negotiation id in answer', async () => {
  const html = readFileSync(new URL('./viewer.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const peers = [], sent = [];
  class Peer {
    constructor() { peers.push(this); this.candidates = []; }
    close() {}
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate(candidate) {
      assert.ok(this.remoteDescription, 'remote description must precede ICE');
      this.candidates.push(candidate);
    }
    async createAnswer() { return { type: 'answer', sdp: 'test' }; }
    async setLocalDescription(description) { this.localDescription = description; }
  }
  const context = vm.createContext({
    location: { hash: '#test' },
    document: { querySelector: () => ({ play: async () => {} }) },
    RTCPeerConnection: Peer,
    console,
    setTimeout: () => {},
    fetch: async (_url, options) => {
      if (options?.body) sent.push(JSON.parse(options.body));
      return { ok: true, json: async () => [] };
    }
  });
  vm.runInContext(source, context);
  await vm.runInContext("handle({type:'ice',id:'first',candidate:{candidate:'early'}})", context);
  await vm.runInContext("handle({type:'offer',id:'first',description:{type:'offer'}})", context);
  assert.equal(peers[0].candidates[0].candidate, 'early');
  assert.equal(sent.find(m => m.type === 'answer').id, 'first');
  await vm.runInContext("handle({type:'offer',id:'second',description:{type:'offer'}})", context);
  await vm.runInContext("handle({type:'ice',id:'first',candidate:{candidate:'stale'}})", context);
  assert.equal(peers[1].candidates.length, 0, 'old negotiation must not affect new peer');
});

test('sender buffers ICE until answer and ignores old negotiation messages', async () => {
  const source = readFileSync(new URL('../scripts/single-tab-stream.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');
  const sent = [], peers = [], timers = [];
  let inbox = [];
  class Canvas {
    width = 100; height = 100;
    getContext() { return { fillRect() {}, drawImage() {} }; }
    captureStream() { return { getTracks: () => [{ stop() {} }] }; }
  }
  class Peer {
    constructor() { peers.push(this); this.candidates = []; }
    close() {} addTrack() {}
    async createOffer() { return { type: 'offer' }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) { this.remoteDescription = d; }
    async addIceCandidate(c) { assert.ok(this.remoteDescription); this.candidates.push(c); }
  }
  const context = vm.createContext({
    URL, AbortSignal, createComposition: () => () => {}, HTMLCanvasElement: Canvas, RTCPeerConnection: Peer,
    crypto: { randomUUID: () => 'current' }, console,
    document: { querySelector: () => new Canvas(), createElement: () => new Canvas(), getElementById: () => null },
    Hooks: { once() {} }, ui: { notifications: { error: assert.fail } },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, clearTimeout() {},
    setTimeout: f => { timers.push(f); return 1; },
    fetch: async (_url, options) => {
      if (options?.body) sent.push(JSON.parse(options.body));
      return { ok: true, json: async () => inbox.splice(0) };
    }
  });
  vm.runInContext(source, context);
  await vm.runInContext("startSingleTabStream('http://127.0.0.1:43119/#'+'a'.repeat(48))", context);
  await new Promise(resolve => setImmediate(resolve));
  inbox.push({type:'ice',id:'current',candidate:{candidate:'early'}}, {type:'ice',id:'old',candidate:{candidate:'stale'}}, {type:'answer',id:'current',description:{type:'answer'}});
  await timers.shift()();
  assert.equal(peers[0].candidates.length, 1);
  assert.equal(peers[0].candidates[0].candidate, 'early');
  assert.equal(sent[0].id, 'current');
  vm.runInContext('stopSingleTabStream()', context);
});
