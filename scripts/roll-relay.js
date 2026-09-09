// Only structured public data is relayed: never scrape a GM's rendered card.
export function publicMessage(message) {
  return !!message && message.visible !== false && message.isContentVisible !== false
    && message.blind === false && Array.isArray(message.whisper) && message.whisper.length === 0
    && !['gmroll', 'blindroll', 'selfroll'].includes(message.flags?.core?.rollMode)
    && !message.flags?.['tactical-stream-view']?.twitch;
}

const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\r\n\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value, length) => Array.from(clean(value)).slice(0, length).join('');

export function summarizeRoll(message, {challengeVisibility = 'none', midi = {}} = {}) {
  if (!publicMessage(message)) return null;
  const origin = message.getOriginatingMessage?.() ?? message;
  if (!publicMessage(origin)) return null;
  const merged = message.flags?.['midi-qol'];
  const rollEntries = merged ? [
    ...merged.attackRoll ? [{roll:merged.attackRoll,type:'attack'}] : [],
    ...['damageRolls','bonusDamageRolls','otherDamageRolls','utilityRolls'].flatMap(key =>
      (merged[key] ?? []).map(roll => ({roll,type:key === 'utilityRolls' ? 'roll' : 'damage'})))
  ] : (message.rolls ?? []).map(roll => ({roll,type:message.flags?.dnd5e?.roll?.type}));
  const rolls = rollEntries.filter(({roll:r}) => r._evaluated !== false && Number.isFinite(r.total ?? r._total));
  const flags = message.flags?.dnd5e ?? {};
  const usage = message.type === 'usage' || flags.messageType === 'usage';
  if (!rolls.length && !usage) return null;
  const item = message.getAssociatedItem?.();
  const activity = message.getAssociatedActivity?.();
  const pieces = [];
  // An unidentified item's underlying document name may be GM-only.
  if (item && item.system?.identified !== false) {
    const kind = ({spell:'Spell',feat:'Feature',weapon:'Weapon',consumable:'Consumable'})[item.type] ?? 'Item';
    pieces.push(`${kind}: ${clip(item.name, 90)}`);
  }
  const type = flags.roll?.type;
  const label = ({attack:'Attack',damage:'Damage',save:'Saving throw',skill:'Skill check',ability:'Ability check',death:'Death save',initiative:'Initiative'})[type] ?? 'Roll';
  const detail = clip(flags.roll?.skillId ?? flags.roll?.abilityId, 12);
  for (const {roll,type:entryType} of rolls) {
    const display = !merged || !message.author?.isGM ? 'full' : entryType === 'attack' ? midi.gmAttackDisplay : midi.gmDamageDisplay;
    if (!['full','hideFormula','attackTotal','totalOnly'].includes(display)) continue;
    const entryLabel = entryType === 'attack' ? 'Attack' : entryType === 'damage' ? 'Damage' : label;
    const damageType = clip(roll.options?.type, 20);
    pieces.push(`${entryLabel}${detail ? ` (${detail})` : ''}: ${roll.total ?? roll._total}${display === 'full' ? ` (${clip(roll.formula ?? roll._formula, 60)})` : ''}${entryType === 'damage' && damageType ? ` ${damageType}` : ''}`);
  }
  // Never use shouldDisplayChallenge here: it always returns true for the GM.
  const showDC = challengeVisibility === 'all' || (!merged && challengeVisibility === 'player' && origin.author?.isGM === false);
  const dc = activity?.save?.dc?.value;
  if (showDC && Number.isFinite(dc) && (!merged || ['all','allShow','allNoRoll'].includes(midi.autoCheckSaves))) {
    const ability = [...(activity.save.ability ?? [])].map(a => clip(a, 12)).join('/');
    pieces.push(`${ability ? `${ability.toUpperCase()} ` : ''}save DC ${dc}`);
  }
  // Summarize outcome counts, never expose target document names or hidden ACs.
  if (merged && showDC && midi.highlightSuccess === true && ['all','allShow'].includes(midi.autoCheckSaves)
      && (!activity?.saveDisplay || ['default','all','allShow'].includes(activity.saveDisplay))) {
    const passed = merged.saveUuids?.length ?? 0, failed = merged.failedSaveUuids?.length ?? 0;
    if (passed || failed) pieces.push(`Saving throws: ${passed} passed, ${failed} failed`);
  }
  if (!pieces.length) return null;
  return {name:clip(message.speaker?.alias || message.author?.name || 'Roll',60), text:clip(pieces.join(' — '), 430)};
}

export function summaryDelta(previous, next) {
  if (!next || previous?.text === next.text) return null;
  if (!previous) return next;
  const before = new Set(previous.text.split(' — '));
  const fresh = next.text.split(' — ').filter(part => !before.has(part));
  if (!fresh.length) return null;
  const title = next.text.split(' — ')[0];
  if (/^(Spell|Feature|Item|Weapon|Consumable):/.test(title) && !fresh.includes(title)) fresh.unshift(title);
  return {...next,text:clip(fresh.join(' — '),430)};
}
