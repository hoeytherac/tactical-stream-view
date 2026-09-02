# Tactical Stream View — Living Journal Edition

Tactical Stream View turns a dedicated Foundry user into a permanent square browser source for Meld Studio, OBS, or another streaming app.

The broadcast layout contains only:

- the tactical canvas;
- a dedicated lower stage for Dice So Nice rolls; and
- translucent, read-only chat cards in a Living Journal-style rail on the right.

The GM gets a **Stream** control set for turning the broadcast on, following the GM camera, pushing the current tactical view, copying the permanent source URL, and opening the connection settings.

## Compatibility

- Foundry Virtual Tabletop 13 or 14
- System agnostic
- Dice So Nice is optional and detected automatically
- Designed for a 1080 × 1080 browser source; other square resolutions also work

## Install

### Install from Foundry

Paste this URL into Foundry's **Install Module → Manifest URL** field:

```text
https://github.com/hoeytherac/tactical-stream-view/releases/latest/download/module.json
```

### Manual install

1. Extract the `tactical-stream-view` folder into your Foundry user-data directory at `Data/modules/`.
2. Restart Foundry if it is already running.
3. Enable **Tactical Stream View — Living Journal Edition** in your world.

## One-time Foundry setup

1. Open Foundry's **User Management** and create a Player-level user named `Stream`.
2. Give that user a unique password. Do not make it a GM or Assistant GM.
3. Give the Stream user Observer permission for the party actors whose shared vision should be visible on the broadcast.
4. Go to **Game Settings → Configure Settings → Module Settings → Tactical Stream View → Configure Stream Connection**.
5. Choose the `Stream` login, enter its password, set the title and accent color, then save.

The Stream password is stored only as a client setting in the GM browser where it was entered. It is not written to the shared world database or GitHub.

## Add the permanent source to Meld Studio

1. Open **Configure Stream Connection** and click **Copy automatic-login URL**.
2. Add a Browser layer in Meld and paste the URL.
3. Set the layer to **1080 × 1080**.
4. Leave that browser source in the scene. Its private URL fragment signs in through Foundry and the selected Stream user automatically enters the broadcast layout whenever the source connects.

The automatic URL contains the Stream password in an encoded URL fragment. The fragment is not sent to web servers as part of an HTTP request, but anyone who can read the browser-source URL can recover it. Use only a dedicated, low-permission Player account. If you prefer not to store the password in Meld, use **Copy safe URL** and enter the password once through Meld's interaction mode.

## During a session

Open the **Stream** controls on the left side of Foundry:

- **Push Stream Mode** switches the permanent browser source between its standby card and the live composition.
- **Follow GM Camera** continuously directs the browser source to the same tactical area the GM is viewing.
- **Push Current Tactical View** sends the current camera position immediately.
- **Copy Browser Source URL** copies the permanent URL again.
- **Configure Stream Connection** opens the setup menu.

The camera position is automatically offset so the GM's focal point remains centered in the visible canvas area rather than disappearing beneath the right-hand journal rail.

## Dice So Nice

Enable Dice So Nice normally for the Stream user. When its `#dice-box-canvas` renderer appears, Tactical Stream View fits it into the lower Dice Stage and asks the renderer to resize. Without Dice So Nice, the stage remains as a quiet placeholder.

For Foundry 13, use the Dice So Nice release compatible with Foundry 13. The current Dice So Nice release targets Foundry 14.

## Privacy and permissions

The browser source is a real Foundry client. It sees only what the selected Stream user can see. This is why a dedicated, low-permission Stream user is important: it prevents GM-only tokens, whispers, journal entries, and hidden information from leaking into the broadcast.

Chat cards are cloned from Foundry's already permission-filtered chat renderer. Buttons and form controls are removed from the stream copy, so the journal rail is display-only.

## Theme customization

The main color can be changed in **Configure Stream Connection**. For campaign-specific styling, edit `styles/tactical-stream-view.css`; all custom selectors begin with `tsv-`, and the primary color is exposed as `--tsv-accent`. The journal rail also receives the class `living-journal`, and every cloned message receives `living-journal-card`, so an existing Living Journal theme can target the stream copies without changing the module script.

## Troubleshooting

**The browser source asks for the Stream password**

The safe URL was used, the stored password is wrong, or Foundry rejected the previous session. Enter the Stream password there, or copy a fresh automatic-login URL from the module settings.

**Foundry warns that the window is 1280 × 720**

Edit the Meld Browser layer and set both width and height to 1080. A 720-pixel-tall source is below Foundry's minimum supported height and is not the intended square composition.

**The source is signed in but does not use the stream layout**  
Confirm the same user is selected under Configure Stream Connection, then reload the browser source.

**The stream is on a different part of the map**  
Enable Follow GM Camera or press Push Current Tactical View. The Stream user must also have permission to view the active scene.

**Dice fill the whole source instead of the Dice Stage**  
Reload the browser source after enabling Dice So Nice. Also confirm the Stream user has Dice So Nice enabled in that client.

**Meld reconnects at every scene change**  
Disable any “refresh browser when scene becomes active” option in the browser layer. Foundry handles scene changes over its existing connection.
