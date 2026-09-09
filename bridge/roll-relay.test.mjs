import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../scripts/roll-relay.js', import.meta.url),'utf8').replace(/export /g,''), context);
const summarize = (message, options={}) => {context.message=message;context.options=options;return vm.runInContext('summarizeRoll(message,options)',context);};
const base = () => ({blind:false,whisper:[],author:{name:'Player',isGM:false},speaker:{alias:'Frank'},flags:{dnd5e:{roll:{type:'attack'}}},rolls:[{total:23,formula:'1d20 + 5'}]});
test('spell attack carries name, type, formula and total',()=>{
  const m=base();m.getAssociatedItem=()=>({name:'Fire Bolt',type:'spell'});
  assert.equal(summarize(m).text,'Spell: Fire Bolt — Attack: 23 (1d20 + 5)');
});
test('public save usage includes DC only when players can see challenges',()=>{
  const m=base();m.type='usage';m.rolls=[];m.getAssociatedItem=()=>({name:'Fireball',type:'spell'});
  m.getAssociatedActivity=()=>({save:{ability:new Set(['dex']),dc:{value:16}}});
  assert.match(summarize(m,{challengeVisibility:'player'}).text,/DEX save DC 16/);
  assert.doesNotMatch(summarize(m).text,/DC/);
  m.author.isGM=true;
  assert.doesNotMatch(summarize(m,{challengeVisibility:'player'}).text,/DC/);
  assert.match(summarize(m,{challengeVisibility:'all'}).text,/DC 16/);
});
test('whispers, blind, self, hidden and private originating cards are excluded',()=>{
  for(const patch of [{blind:true},{whisper:['gm']},{isContentVisible:false},{visible:false},{flags:{core:{rollMode:'selfroll'}}}]) assert.equal(summarize({...base(),...patch}),null);
  const m=base();m.getOriginatingMessage=()=>({...base(),whisper:['gm']});assert.equal(summarize(m),null);
  assert.equal(summarize({...base(),blind:undefined}),null);
});
test('features and damage types included, unidentified names and regular chat excluded',()=>{
  const m=base();m.flags.dnd5e.roll.type='damage';m.rolls=[{total:8,formula:'2d6',options:{type:'fire'}}];
  m.getAssociatedItem=()=>({name:'Breath',type:'feat'});assert.match(summarize(m).text,/Feature: Breath.*8.*fire/);
  m.getAssociatedItem=()=>({name:'Secret Sword',type:'weapon',system:{identified:false}});assert.doesNotMatch(summarize(m).text,/Secret/);
  assert.equal(summarize({...base(),rolls:[]}),null);
  assert.equal(summarize({...base(),flags:{'tactical-stream-view':{twitch:{direction:'in'}}}}),null);
});
test('long multi-roll summaries remain below Twitch limit with name prefix',()=>{
  const m=base();m.rolls=Array.from({length:50},()=>({total:9,formula:'1d20 + 5'}));
  assert.ok(Array.from(summarize(m).text).length<=430);
});
