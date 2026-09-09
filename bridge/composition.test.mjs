import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('composition only copies after rendering and removes listeners on stop', () => {
  let draw, copies = 0, removed = 0;
  const context = vm.createContext({
    canvas: { app: { renderer: { on: (event, f) => { assert.equal(event, 'postrender'); draw = f; }, off: (_event, f) => { assert.equal(f, draw); removed++; } } } },
    document: { getElementById: id => id === 'board' ? { width: 100, height: 100 } : null },
    game: { messages: { contents: [] } }, Hooks: { on: () => 1, off: () => {} },
    setInterval: () => 1, clearInterval: () => {}, console,
    output: { width: 1080, height: 1080, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, drawImage() { copies++; } }) }
  });
  const code = readFileSync(new URL('../scripts/stream-composition.js', import.meta.url), 'utf8').replace(/export /g, '');
  vm.runInContext(code, context);
  const dispose = vm.runInContext('createComposition(output)', context);
  assert.equal(copies, 0, 'no unsynchronized initial copy');
  draw(); assert.equal(copies, 1);
  dispose(); assert.equal(removed, 1);
  draw(); assert.equal(copies, 1);
  for (const message of [{blind:true}, {whisper:['gm']}, {visible:false}]) {
    context.message = message;
    assert.equal(vm.runInContext('isPublicMessage(message)', context), false);
  }
  context.message = {visible:true, whisper:[], blind:false};
  assert.equal(vm.runInContext('isPublicMessage(message)', context), true);
});
