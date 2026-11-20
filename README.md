# Claude Bot: Pixel Octo

A transparent, always-on-top desktop companion for Nobara Linux (KDE Plasma, Wayland). A 3D voxel
version of the Pixel Octo emote character reacts to Claude Code activity and system load, shows
tiny CPU/GPU stats and syncs the Dell G15's 4-zone keyboard RGB to its mood.

![The voxel octo: front, back and three-quarter view](docs/img/octo-phase1.png)

**Status:** Phase 1 of 7 done. The 3D octo runs in a plain browser page. Full plan: [`PROMPT.md`](PROMPT.md);
progress: [`docs/STATUS.md`](docs/STATUS.md); hardware notes: [`docs/HARDWARE.md`](docs/HARDWARE.md).

## Setup (Nobara / Fedora)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm install
```

## Run

```bash
npm run dev:web        # http://127.0.0.1:5173 : the octo + buttons for idle, blink, turnAround, jump, roll
                       # add ?speed=0.1 to the URL to watch every move in slow motion; drag to orbit
.venv/bin/python tools/clean_emotes.py   # rebuild assets/emotes-clean/ from the sticker sheet
```

## Test

```bash
npm test                                   # voxel model, face culling, motion maths, frame budget
.venv/bin/python tools/test_clean_emotes.py   # sprite cleaner round trip
```

## Layout

| Path | What |
|---|---|
| `assets/emotes-original/` | the 48 emote PNGs + sticker sheets (reference only, never edited) |
| `assets/emotes-clean/` | 48 clean transparent sprites + `contact_sheet.png` (generated) |
| `tools/clean_emotes.py` | sheet → clean sprites |
| `voxels/octo.json` | hand-authored voxel model (text layers, format in its `about` field) |
| `ui/scene3d/` | `Scene3D.js` renderer, `moves.js` motion library, `voxels.js` model parser |
| `docs/` | `HARDWARE.md` (Phase 0 report), `STATUS.md` (progress) |

## Art

The Pixel Octo emote pack in `assets/` is the project owner's own character art.
