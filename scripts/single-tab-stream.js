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
    const existing=document.getElementById('tactical-stream-pairing');
    if(existing){existing.querySelector('input').focus();return;}
    const panel=document.createElement('section');
    panel.id='tactical-stream-pairing';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','Connect Meld');
    panel.style.cssText='position:fixed;bottom:52px;right:16px;z-index:10001;width:min(480px,calc(100vw - 32px));padding:20px;background:#101923;color:#edf5ff;border:1px solid #2f9dff;border-radius:8px;box-shadow:0 8px 32px #000';
    panel.innerHTML='<form><h2>Connect Meld</h2><label for="tactical-pairing-url">Local helper URL (same as Meld)</label><input id="tactical-pairing-url" type="text" required autocomplete="off" placeholder="http://127.0.0.1:43119/#…" style="width:100%;margin:12px 0;color:#fff;background:#07111b"><p>This shares your current canvas, including GM-visible information. Test off-stream.</p><p role="status" aria-live="polite"></p><div style="display:flex;gap:8px"><button type="submit">Connect</button><button type="button">Cancel</button></div></form>';
    const form=panel.querySelector('form'), input=panel.querySelector('input');
    const submit=panel.querySelector('[type="submit"]'), status=panel.querySelector('[role="status"]');
    panel.querySelector('[type="button"]').addEventListener('click',()=>{panel.remove();button.focus();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();submit.disabled=true;status.textContent='Connecting to the local helper…';
      try{
        await startSingleTabStream(input.value.trim());
        if(active){button.textContent='Stop Meld feed';panel.remove();button.focus();}
        else status.textContent='Connection stopped. Check the helper and try again.';
      }catch(e){status.textContent=e.message;}
      finally{submit.disabled=false;}
    });
    document.body.append(panel);input.focus();
  });
  document.body.append(button);
});
