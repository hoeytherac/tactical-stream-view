# Single-tab prototype — not a released replacement

Run `node bridge/server.mjs` from the module checkout. It binds only to this computer on port 43119. Keep it running while playing. It prints a pairing URL; a restart generates a new pairing token.

Use that URL as the Meld Browser source. The receiver only plays video, not Foundry. In your existing Foundry tab, use the module API `game.modules.get('tactical-stream-view').api.startSingleTabStream(url)` with that same URL. Stop with `stopSingleTabStream()` on the same API. A friendly configuration control is still pending.

This prototype captures your current canvas visibility and camera. It does not yet include chat, Dice So Nice, separate spectator vision, Twitch, automatic reconnection, or a permanent pairing URL. Browser local-network permission and actual WebGL capture need live testing. It intentionally does not store Foundry passwords.
