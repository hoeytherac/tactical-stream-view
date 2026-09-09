import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const transportCode=readFileSync(new URL('../scripts/twitch-transport.js',import.meta.url),'utf8').replace(/export /g,'');
function runtime(extra={}) {
  const context=vm.createContext({URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,fetch,WebSocket:class {},...extra});
  vm.runInContext(transportCode,context);return context;
}
test('native fetch keeps its browser receiver during authorization',async()=>{
  const context=runtime();
  vm.runInContext(`globalThis.fetch = function () {
    if (this !== globalThis) throw Error('Illegal invocation');
    return Promise.resolve({ok:true,json:async()=>({user_code:'TEST',expires_in:600})});
  };`,context);
  const client=vm.runInContext('new TwitchTransport({onMessage(){},onStatus(){}})',context);
  assert.equal((await client.request('https://id.twitch.tv/oauth2/device')).user_code,'TEST');
});
test('Twitch output is explicit plain text with author prefix and length limit',()=>{
  const context=runtime();
  assert.equal(vm.runInContext("outgoingText('Frank','Hello viewers')",context),'[Frank] Hello viewers');
  assert.throws(()=>vm.runInContext("outgoingText('Frank','x'.repeat(500))",context),/500/);
  assert.throws(()=>vm.runInContext("outgoingText('Frank','   ')",context),/contain text/);
  assert.equal(vm.runInContext("escapeChat('<script>[[1d20]]@UUID')",context),'&#60;script&#62;&#91;&#91;1d20&#93;&#93;&#64;UUID');
});
test('relay rejects private, blind, ordinary and author-mismatched messages',()=>{
  const source=readFileSync(new URL('../scripts/twitch-chat.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
  const context=vm.createContext({Hooks:{on(){},once(){}}});vm.runInContext(source,context);
  const message={author:{id:'player'},flags:{'tactical-stream-view':{twitch:{direction:'out',status:'pending',text:'hello'}}},whisper:[],blind:false};
  context.message=message;
  assert.equal(vm.runInContext("eligibleOutgoing(message,'player')",context),true);
  assert.equal(vm.runInContext("eligibleOutgoing(message,'other')",context),false);
  message.whisper=['gm'];assert.equal(vm.runInContext("eligibleOutgoing(message,'player')",context),false);
  message.whisper=[];message.blind=true;assert.equal(vm.runInContext("eligibleOutgoing(message,'player')",context),false);
  message.blind=false;message.flags={};assert.equal(vm.runInContext("eligibleOutgoing(message,'player')",context),false);
});
test('Twitch send reports acceptance, enforces cooldown and clears token on stop',async()=>{
  let posted;
  const context=runtime({fetch:async(url,options)=>{posted={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({data:[{is_sent:true,message_id:'sent-1'}]})};}});
  const client=vm.runInContext("new TwitchTransport({onMessage(){},onStatus(){}})",context);
  client.ready=true;client.token='test-only';client.clientId='app';client.userId='coalsan-id';
  assert.equal(await client.send('Frank','Hi'), 'sent-1');
  assert.equal(posted.url,'https://api.twitch.tv/helix/chat/messages');
  assert.equal(posted.body.message,'[Frank] Hi');
  await assert.rejects(client.send('Frank','Again'),/wait/);
  client.stop();assert.equal(client.token,null);assert.equal(client.ready,false);
  await assert.rejects(client.send('Frank','After stop'),/not connected/);
});
