// Only structured public data is relayed: never scrape a GM's rendered card.
export function publicMessage(message) {
  return !!message && message.visible !== false && message.isContentVisible !== false
    && message.blind === false && Array.isArray(message.whisper) && message.whisper.length === 0
    && !['gmroll', 'blindroll', 'selfroll'].includes(message.flags?.core?.rollMode)
    && !message.flags?.['tactical-stream-view']?.twitch;
}

const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\r\n\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value, length) => Array.from(clean(value)).slice(0, length).join('');

export function summarizeRoll(message, {challengeVisibility = 'none'} = {}) {
  if (!publicMessage(message)) return null;
  const origin = message.getOriginatingMessage?.() ?? message;
  if (!publicMessage(origin)) return null;
  const rolls = (message.rolls ?? []).filter(r => r._evaluated !== false && Number.isFinite(r.total));
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
  for (const roll of rolls) {
    const damageType = clip(roll.options?.type, 20);
    pieces.push(`${label}${detail ? ` (${detail})` : ''}: ${roll.total} (${clip(roll.formula, 60)})${type === 'damage' && damageType ? ` ${damageType}` : ''}`);
  }
  // Never use shouldDisplayChallenge here: it always returns true for the GM.
  const showDC = challengeVisibility === 'all' || (challengeVisibility === 'player' && origin.author?.isGM === false);
  const dc = activity?.save?.dc?.value;
  if (showDC && Number.isFinite(dc)) {
    const ability = [...(activity.save.ability ?? [])].map(a => clip(a, 12)).join('/');
    pieces.push(`${ability ? `${ability.toUpperCase()} ` : ''}save DC ${dc}`);
  }
  if (!pieces.length) return null;
  return {name:clip(message.speaker?.alias || message.author?.name || 'Roll',60), text:clip(pieces.join(' — '), 430)};
}
