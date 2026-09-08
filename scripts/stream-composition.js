// Copy the board synchronously after Pixi renders, never from an unrelated RAF.
export function createComposition(output) {
  const ctx = output.getContext('2d');
  const renderer = canvas.app?.renderer;
  if (!renderer?.on || !renderer?.off) throw Error('Foundry renderer is not ready. Open a scene first.');
  let stopped = false, diceCanvas, diceStream, diceVideo;
  const width = output.width, height = output.height;
  const rail = Math.round(width * .29), stage = width - rail;
  function releaseDice() {
    diceStream?.getTracks().forEach(track => track.stop());
    if (diceVideo) { diceVideo.pause(); diceVideo.srcObject = null; }
    diceStream = diceVideo = diceCanvas = null;
  }
  function updateDice() {
    const next = document.getElementById('dice-box-canvas');
    if (next === diceCanvas) return;
    releaseDice();
    if (!next?.captureStream) return;
    diceCanvas = next;
    diceStream = next.captureStream(30);
    diceVideo = document.createElement('video');
    diceVideo.muted = true; diceVideo.playsInline = true;
    diceVideo.srcObject = diceStream;
    diceVideo.play().catch(error => console.warn('Tactical stream dice video:', error.message));
  }
  function fit(source, x, y, w, h, sw, sh) {
    if (!sw || !sh) return;
    const scale = Math.min(w / sw, h / sh);
    ctx.drawImage(source, x + (w - sw * scale) / 2, y + (h - sh * scale) / 2, sw * scale, sh * scale);
  }
  function textLines(text, x, y, maxWidth, count) {
    const words = String(text).slice(0, 3000).split(/\s+/);
    let line = '', row = 0;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, x, y + row++ * 23, maxWidth);
        line = word;
        if (row >= count - 1) break;
      } else line = next;
    }
    ctx.fillText(line, x, y + row * 23, maxWidth);
  }
  let cards = [];
  function refreshCards() {
    cards = (game.messages?.contents || []).filter(isPublicMessage).slice(-5).map(message => {
      const fragment = document.createElement('div');
      fragment.innerHTML = message.content || '';
      fragment.querySelectorAll('.secret,script,style,[hidden]').forEach(node => node.remove());
      return { name: message.speaker?.alias || message.author?.name || 'Adventurer', text: fragment.textContent || '', rolls: (message.rolls || []).map(roll => `${roll.formula} = ${roll.total}`).join(' · ') };
    });
  }
  const hookIds = ['createChatMessage','updateChatMessage','deleteChatMessage'].map(name => [name, Hooks.on(name, refreshCards)]);
  refreshCards();
  const diceTimer = setInterval(updateDice, 1000);
  updateDice();
  function draw() {
    if (stopped) return;
    const board = document.getElementById('board');
    if (!board?.width || !board.height) return;
    try {
      ctx.fillStyle = '#030811'; ctx.fillRect(0, 0, width, height);
      fit(board, 0, 0, stage, height * .76, board.width, board.height);
      ctx.strokeStyle = '#2f9dff'; ctx.strokeRect(8, height * .76, stage - 16, height * .24 - 8);
      ctx.fillStyle = '#96caf0'; ctx.font = '17px Georgia'; ctx.fillText('DICE SO NICE', 20, height * .76 + 26);
      if (diceVideo?.readyState >= 2 && getComputedStyle(diceCanvas).display !== 'none') fit(diceVideo, 12, height * .76 + 34, stage - 24, height * .24 - 46, diceVideo.videoWidth, diceVideo.videoHeight);
      ctx.fillStyle = '#b8dfff'; ctx.font = 'bold 21px Georgia'; ctx.fillText('LIVING JOURNAL', stage + 16, 34);
      cards.forEach((card, i) => {
        const y = 54 + i * 200;
        ctx.fillStyle = 'rgba(17,27,41,.78)'; ctx.fillRect(stage + 8, y, rail - 16, 188);
        ctx.strokeStyle = '#857042'; ctx.strokeRect(stage + 8, y, rail - 16, 188);
        ctx.fillStyle = '#dec68e'; ctx.font = 'bold 19px Georgia'; ctx.fillText(card.name, stage + 20, y + 28, rail - 40);
        ctx.fillStyle = '#e8e4d8'; ctx.font = '18px Georgia'; textLines(card.text, stage + 20, y + 55, rail - 40, 4);
        ctx.fillStyle = '#9cd6ff'; ctx.font = 'bold 18px Georgia'; ctx.fillText(card.rolls, stage + 20, y + 171, rail - 40);
      });
    } catch (error) { console.warn('Tactical stream composition:', error.message); }
  }
  renderer.on('postrender', draw);
  return () => {
    stopped = true; renderer.off('postrender', draw); clearInterval(diceTimer);
    hookIds.forEach(([name, id]) => Hooks.off(name, id)); releaseDice();
  };
}

export function isPublicMessage(message) {
  return message.visible !== false && !message.blind && !(message.whisper?.length);
}
