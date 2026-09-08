let active;

export async function startSingleTabStream(sourceUrl) {
  stopSingleTabStream();
  const url = new URL(sourceUrl);
  if (url.origin !== 'http://127.0.0.1:43119' || !/^[a-f0-9]{48}$/.test(url.hash.slice(1))) throw Error('Paste the current local helper URL.');
  const board = document.querySelector('#board');
  if (!(board instanceof HTMLCanvasElement)) throw Error('Open a Foundry scene before sharing.');
  const endpoint = `${url.origin}/signal?role=sender&token=${url.hash.slice(1)}`;
  const output = document.createElement('canvas');
  output.width = output.height = 1080;
  const ctx = output.getContext('2d');
  const stream = output.captureStream(30);
  const session = active = { stream, peer: null, timer: null, frame: null, id: null, pending: [] };
  const send = async message => {
    const r = await fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(message)});
    if (!r.ok) throw Error('Local helper pairing failed.');
  };
  async function offer() {
    if (active !== session) return;
    session.peer?.close();
    const id = session.id = crypto.randomUUID();
    session.pending = [];
    const peer = session.peer = new RTCPeerConnection({iceServers:[]});
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    peer.onicecandidate = e => { if(e.candidate && active === session && session.peer === peer) send({type:'ice',id,candidate:e.candidate}).catch(console.error); };
    await peer.setLocalDescription(await peer.createOffer());
    if (active === session && session.peer === peer) await send({type:'offer',id,description:peer.localDescription});
  }
  function draw() {
    if(active !== session) return;
    ctx.fillStyle='#030811';ctx.fillRect(0,0,1080,1080);
    // Draw only the WebGL canvas bitmap, never desktop UI or character sheets.
    const scale=Math.min(1080/board.width,1080/board.height);
    ctx.drawImage(board,(1080-board.width*scale)/2,(1080-board.height*scale)/2,board.width*scale,board.height*scale);
    session.frame=requestAnimationFrame(draw);
  }
  async function poll() {
    if(active !== session)return;
    try {
      const r=await fetch(endpoint);if(!r.ok)throw Error('Local helper unavailable');
      for(const m of await r.json()) {
        if (active !== session) return;
        if(m.type==='ready') await offer();
        else if(m.id === session.id && m.type==='answer') {
          await session.peer.setRemoteDescription(m.description);
          for (const candidate of session.pending.splice(0)) await session.peer.addIceCandidate(candidate);
        }
        else if(m.id === session.id && m.type==='ice') {
          if (session.peer.remoteDescription) await session.peer.addIceCandidate(m.candidate);
          else session.pending.push(m.candidate);
        }
      }
      if (active === session) session.timer=setTimeout(poll,500);
    } catch(e) { if (active === session) { stopSingleTabStream();ui.notifications.error(`Tactical stream stopped: ${e.message}`); } }
  }
  try { draw();await offer();poll(); } catch(e) {stopSingleTabStream();throw e;}
}

export function stopSingleTabStream() {
  if(!active)return;
  const s=active;active=null;clearTimeout(s.timer);cancelAnimationFrame(s.frame);
  s.peer?.close();s.stream.getTracks().forEach(t=>t.stop());
  const button = document.getElementById('tactical-stream-connect');
  if (button) button.textContent = 'Connect Meld';
}

Hooks.once('ready',()=>{
  game.modules.get('tactical-stream-view').api={startSingleTabStream,stopSingleTabStream};
  const button=document.createElement('button');
  button.id='tactical-stream-connect';
  button.type='button';button.textContent='Connect Meld';
  button.style.cssText='position:fixed;bottom:8px;right:330px;z-index:10000;width:auto;padding:6px 12px';
  button.addEventListener('click',async()=>{
    if(active){stopSingleTabStream();button.textContent='Connect Meld';return;}
    const url=window.prompt('Paste the pairing URL printed by the Tactical Stream local helper:');
    if(!url)return;
    try{await startSingleTabStream(url);button.textContent='Stop Meld feed';}
    catch(e){ui.notifications.error(e.message);}
  });
  document.body.append(button);
});
