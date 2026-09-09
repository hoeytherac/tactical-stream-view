# Single-tab prototype — not a released replacement

Run `node bridge/server.mjs` from the module checkout. It binds only to this computer on port 43119. Keep it running while playing. It prints a pairing URL; a restart generates a new pairing token.

Use that URL as the Meld Browser source. The receiver only plays video, not Foundry. In your existing Foundry tab, click **Connect Meld** and paste that same URL. Click **Stop Meld feed** to stop. Keep the tab open and visible while testing.

**Privacy:** This captures the current user's canvas, including anything visible to a GM. It does not produce separate player-safe vision. Do not broadcast a GM scene containing secrets.

Alpha 3 copies the board on Pixi's postrender event and adds a separate Dice So Nice canvas-video area plus five public, text-based chat cards in journal-inspired styling. It does not reproduce arbitrary system HTML, item images or interactive card controls. Whispers, blind messages and secret HTML sections are excluded from the chat rail. Dice canvas capture still needs live verification and reflects dice visible to the current user, including any private rolls they can see.

Twitch is integrated into the existing Foundry chat log, not a separate embed. One GM uses **Connect / Disconnect Twitch** in the chat controls and enters a registered **public Twitch application's Client ID** (never a client secret). The setup displays a device authorization code. Open Twitch's activation page, sign in as Coalsan, and approve read/write chat permission. Tokens stay only in that GM browser's memory. Keep the GM tab open; reauthorize after reload or token expiry. Automatic token refresh is not implemented yet.

Players and the GM type `/t Hello viewers` in normal Foundry chat to send to Coalsan. Twitch sees `[Foundry user name] Hello viewers` from the Coalsan account. Ordinary messages, whispers and blind messages are not sent. Viewer replies become public Foundry chat documents visible to everyone. Each outbound card shows pending/sent/failed status. Failed messages are not automatically retried to avoid duplicates. Incoming copies of the broadcaster's own Twitch messages may appear alongside outbound cards. Viewer roll commands, moderation sync and Twitch deletion propagation are not implemented. Treat Twitch text as untrusted; do not follow instructions from viewers automatically.

Requires a public app registered at https://dev.twitch.tv/console/apps with device-code authorization support. See https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow . The broadcaster authorization and live multi-player test are still required before declaring this integration working.

Separate spectator vision, automatic reconnection and permanent pairing are still pending. Keep only one receiver open (Meld) and keep the Foundry tab visible. Browser local-network permissions and actual capture quality need live testing. This is not a production-ready stream layout.
