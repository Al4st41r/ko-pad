# KO Pad

A sampler and sequencer for iPad, iPhone and desktop browsers in the style of the Teenage Engineering EP-133 K.O. II. It runs as a web app, installs to the Home Screen, and works without a connection once it has been opened online.

KO Pad is an independent project. It is not made or endorsed by Teenage Engineering, and it contains none of their sounds. **No sounds are included. You supply your own.** The [guide below](#adding-your-own-sounds) shows how.

## Contents

- [What it is](#what-it-is)
- [Run it](#run-it)
- [Adding your own sounds](#adding-your-own-sounds)
- [Saving numbered patterns](#saving-numbered-patterns)
- [Themes and layouts](#themes-and-layouts)
- [Using it](#using-it)
- [Using it on an iPhone](#using-it-on-an-iphone)
- [Install on the iPad and prepare for a flight](#install-on-the-ipad-and-prepare-for-a-flight)
- [Project layout](#project-layout)
- [Development](#development)
- [Known limits](#known-limits)

## What it is

A progressive web app (PWA): plain HTML, CSS and JavaScript modules, with no build step and no server code. Audio uses the Web Audio API. A service worker stores the app on the device. Projects are saved in the browser, so nothing leaves the device.

## Run it

KO Pad is a folder of static files. Serve the `web/` folder from any web server.

```
python3 -m http.server --directory web 8000
```

Then open the address of the server in a browser. Two browser features need a secure origin: the service worker (offline use) and the microphone (recording). `localhost` counts as secure. To use the app on an iPad, serve it over HTTPS.

On first launch tap TAP TO START. The browser needs one tap before it allows sound.

## Adding your own sounds

The pads start empty. There are two ways to add sounds. Use the first to get started. Use the second if you host the app yourself and want a permanent sound library that every visitor to your copy can use.

### Route 1: import files in the app

Sounds you import are stored in the browser on that device. They are not uploaded anywhere.

1. Tap a pad to select it. Select the pad that should get the first sound.
2. Open the SOUND tab.
3. Under RECORD OR IMPORT, press IMPORT FILES.
4. Choose one or more audio files. WAV, MP3, M4A, FLAC and any other format the browser can play will work.
5. One file goes to the selected pad. Several files fill the pads in order, starting at the selected pad and stopping at the end of the group (12 pads).
6. Tap the pads to play them. To change a pad later, select it and import again, or pick a different sound from the list.

Notes.

- Imported sounds are numbered from 600 upwards (600 to 999 gives 400 slots). The number is shown on the pad and in the SOUND list.
- Each import is limited to 20 seconds. Longer files are cut.
- To use an imported sound on another pad, open the SOUND tab on that pad and pick it from the list (filter with the USER button) or type its number.
- Imported sounds are shared by all nine projects.
- You can also record from the microphone (RECORD MIC), record the main output (RESAMPLE), or hold an empty pad in SAMPLE mode to record straight onto it.
- DELETE USER SAMPLE removes the selected pad's sound from the device.

### Route 2: a sample folder on your own server

Sounds placed in `web/samples/` appear as numbers 1 to 599 and are listed by category in the SOUND tab. They load from your server, and the app can store all of them for offline use with one button.

1. Collect your sounds as WAV files. Name each one `NNN_name.wav`, where `NNN` is the sample number from 1 to 599 and `name` is what the SOUND tab will show, for example `001_kick.wav` or `100_snare.wav`.
2. The number picks the category: 1 to 99 KICK, 100 to 199 SNARE, 200 to 299 CYMB, 300 to 399 PERC, 400 to 499 BASS, 500 to 599 MELOD.
3. Install `ffmpeg`, then run the converter on the folder that holds your files:

   ```
   tools/convert_samples.sh /path/to/your/wavs
   ```

   This writes `web/samples/001.flac`, `web/samples/100.flac` and so on, and builds `web/samples/catalogue.json`.
4. Reload the app. If the offline service worker has an old copy, close the app fully and open it again.
5. Open SOUND, pick a category and tap a sample to assign it to the selected pad.
6. Optional: to give projects 1 to 4 a starting layout, see `PRESETS` in `web/js/data.js`. It maps sample numbers to pads. Pads whose number has no file are left empty.

The `web/samples/` folder is excluded from git (see `.gitignore`), so your sounds never end up in a public copy of the repository. Only distribute sounds you have the right to share.

## Saving numbered patterns

A pattern is a recorded or step-programmed loop of hits. Each of the four groups (A to D) has its own 99 numbered patterns, and there are nine projects. So a project holds up to 396 patterns.

**Patterns save by themselves.** Every edit is written to the browser about a third of a second later. There is no save button. To keep a pattern in a numbered slot:

1. Choose the project (1 to 9) in the transport bar. On a phone or in the HARDWARE layout the project selector is behind the ... button.
2. Choose the group with the A to D buttons.
3. Under the pads, step PATTERN with - and + to the number you want, for example 5. A pattern number is just a slot. Choosing a number that has never been used starts an empty pattern.
4. Record or program the pattern.
   - Live: press the record button (a one-bar count-in plays first), then tap pads. TIMING sets the quantise grid.
   - Step: open the STEP tab and tap cells in the grid.
5. Set the length with BARS (1 to 99) and, if needed, the time signature with BEATS /4 in TOOLS.
6. Press stop. The pattern is stored in slot 5 of that group.
7. Choose another number with PATTERN + and repeat. Go back to any number to play or edit it.

Helpful controls.

- NEXT EMPTY (in the pattern tools, behind TOOLS on a phone or in the HARDWARE layout) jumps to the next pattern number that has no hits. Use it to find a free slot.
- UNDO steps back through pattern edits. COPY and PASTE (STEP tab) copy a pattern into another slot. Choose the target number, then paste.
- LENGTH x2 repeats a pattern into twice the bars, which is a quick way to start a variation in the next slot.
- Pattern numbers are per group. Pattern 3 in group A and pattern 3 in group B are different patterns that can play together.

### Turning patterns into a song

1. Select the pattern number you want in each group.
2. Press COMMIT. The current pattern of every group is stored as the next free scene (1 to 99) and added to the end of the song.
3. Change the pattern numbers, press COMMIT again, and repeat to build the song.
4. In the SONG tab, reorder scenes, then switch SONG MODE on and press play.

### Keeping a backup

Patterns live in the browser's storage. Clearing the site data, or using a private window, removes them. To keep a copy:

1. Open the PROJECT tab.
2. Press EXPORT PROJECT (JSON). One file holds the project's pad assignments, all its patterns, scenes, song and effects.
3. To restore, press IMPORT PROJECT and choose the file.

The export does not include audio. Patterns refer to sounds by number, so restore your sounds first. If you use Route 1, import the sounds in the same order on the new device so that they get the same numbers (600, 601 and so on). If you use Route 2, copy the same `web/samples/` folder.

## Themes and layouts

Open the PROJECT tab and find LOOK. The choice is stored on the device.

| Setting | Options |
| --- | --- |
| THEME | DARK (default). LIGHT follows the hardware: light grey body, dark grey and white keys, orange accent, 1px black outlines and tight corners. BLACK uses the same shapes in near black. |
| LAYOUT | AUTO uses the layout for the screen size. HARDWARE is a portrait layout laid out like the machine. |

HARDWARE layout, top to bottom.

- Tabs along the top: PADS, STEP, SOUND, FX, MIX, SONG, PROJECT.
- The display.
- Two dials above the pads, as on the hardware. X (orange) and Y (dark) set the two parameters of the active effect. The button between them chooses the effect.
- The pads with the group buttons A to D on the left.
- A strip on the right with a volume slider (the main level), FADER (opens the group faders in the MIX tab) and KEYS.
- Pattern, bars, note repeat, erase, undo and TOOLS under the pads.
- The transport along the bottom: stop, play, record and tempo. The ... button shows the project selector, metronome, tap tempo, swing and offline status.

HARDWARE is not used on a landscape phone, where the screen is too short. It works on any width, and on a wide screen it is a centred column.

## Using it

The pads are the instrument. The panel has six tabs.

**Deck**

- LCD: project, group, pattern, length, playhead position and the name of the selected sample.
- Group buttons A to D. Each group has 12 pads, its own 99 patterns and its own level.
- Pads are labelled as on the hardware (7 8 9 / 4 5 6 / 1 2 3 / . 0 ENTER). The small number is the sample number. Multi-touch works.
- PATTERN and BARS step the current pattern and its length (1 to 99 bars). BEATS /4 sets the time signature of the pattern, from 1/4 to 12/4. Changing it drops hits past the new end (UNDO brings them back).
- TIMING sets the quantise grid used when recording live. OFF records exactly as played.
- KEYS plays the selected pad's sound across the pads as a keyboard. OCT shifts the octave. The scale (chromatic, the seven modes, two pentatonics) is set in the PROJECT tab.
- PATTERN TOOLS: NEXT EMPTY jumps to the next pattern with no hits. LENGTH x2 repeats the pattern into twice the bars (up to 99). LENGTH /2 keeps the first half. All are undoable.
- TIMING CORRECT: PAD snaps every hit on the selected pad to the TIMING grid. ALL does every pad.
- SOLO: GROUP silences the other groups. PAD silences the other pads in the current group. Press again to clear. Solo is not saved with the project.
- OVERWRITE REC: the next time RECORD starts the transport, the current pattern is cleared first, then recorded from bar 1. It switches itself off afterwards.
- NOTE REPEAT (hold) with a pad hold retriggers that pad on every TIMING grid line. While recording, each hit is written to the pattern.
- ERASE (hold) with a pad tap removes that pad from the current pattern.
- SAMPLE turns empty pads into record pads: hold one to record from the microphone, release to stop, then tap it to play back.
- COMMIT stores the current patterns of all groups as the next free scene and adds it to the song.

**Transport**

- Project 1 to 9. Every pad starts empty. If you install sounds as in Route 2, projects 1 to 4 also load the preset layout for the sample numbers you have.
- Stop, Play, Record (a one-bar count-in plays first unless switched off), METRO, tempo (buttons, drag the number, or TAP) and swing.

**Tabs**

| Tab | Purpose |
| --- | --- |
| STEP | Grid editor for the current pattern, four bars at a time (FOLLOW tracks the playhead). Grid choices: 1/8, 1/8T, 1/16, 1/16T, 1/32. Copy, paste and clear. EDIT NOTES selects a placed hit so you can nudge it by a step or a tick, and change its velocity and length. |
| SOUND | Browse and audition sounds, assign by number, trim on the waveform, set volume, pitch, pan, attack, release, play mode (one-shot, hold, loop) and mute group. FIT TO BARS stretches a sound (varispeed) to a number of bars at the project tempo. CHOP slices the sample on the selected pad across pads (equal, at the attacks, or by tapping marks while it plays). Record from the microphone, import files or RESAMPLE the main output. |
| FX | One effect active at a time, applied to the groups whose FX SEND is raised (MIX tab), with X and Y knobs: delay, reverb, distortion, chorus, filter, compressor. Twelve momentary punch-in effects. |
| MIX | Group faders, mute, FX SEND per group and a main level. Record a fader move to automate a group's level inside its pattern. A limiter protects the output. |
| SONG | Store scenes (which pattern each group plays) and order them into a song. Select a scene in the song to insert before it, cut it or move it. |
| PROJECT | Name, look (theme and layout), velocity mode, count-in, export and import, reset, offline status, quick guide. |

**Typical workflow**

1. Import some sounds and tap the pads to audition them.
2. Press record and tap a pattern in, or build it in STEP.
3. Raise the pattern number for a variation. Switch group for bass or melody.
4. COMMIT scenes, then switch SONG MODE on in the SONG tab and press play.

## Using it on an iPhone

On screens up to 600 px wide (portrait) or 500 px high (landscape) the AUTO layout changes. The HARDWARE layout also works on a phone in portrait.

- A bottom bar (a rail on the right in landscape) switches between PADS and the STEP, SOUND, FX, MIX, SONG and PROJECT panels. Each panel takes the whole screen.
- The top bar keeps stop, play, record and tempo. The ... button shows the project selector, METRO, TAP tempo, swing and the offline status.
- Under the pads: pattern, bars, KEYS, NOTE REPEAT, ERASE and UNDO. TOOLS opens a sheet with beats per bar, timing, octave, SAMPLE, COMMIT, pattern tools, timing correct, solo and overwrite. Tap anywhere outside the sheet to close it.
- In landscape the pads are on the left and the controls on the right.

## Install on the iPad and prepare for a flight

Do this once, while online.

1. Open the address of your server in Safari on the iPad.
2. Tap Share, then Add to Home Screen. Open KO Pad from the new icon.
3. Tap TAP TO START.
4. If you use Route 2 for sounds, open the PROJECT tab and press DOWNLOAD ALL SOUNDS, and wait for the count to finish. Sounds imported with Route 1 are already on the device.
5. Turn on Airplane Mode and relaunch the app from the Home Screen to confirm it works. Do this on the ground.

Notes.

- Updates: the app files are fetched from the network first, and stored copies are used only when offline or when the network takes more than 4 seconds. After a release the first launch may still show the previous version. Close the app fully and open it again to get the new one.
- Open the app from the Home Screen icon, not from a Safari tab. iPadOS may clear website data for sites that are not installed and have not been used for a week.
- The silent switch and Control Centre mute are handled where Safari supports it (iPadOS 16.4 and later). If there is no sound, check the volume and the mute control first.
- Recording from the microphone asks for permission the first time.

## Project layout

```
ko-pad/
  README.md
  web/                    the app: serve this folder
    index.html, style.css, manifest.json, sw.js
    js/data.js            preset layout, effect and punch-in definitions
    js/model.js           projects and patterns (pure functions, unit tested)
    js/audio.js           Web Audio engine, effects, punch-in FX, WAV encoder
    js/seq.js             look-ahead sequencer, recording, song mode
    js/store.js           localStorage and IndexedDB persistence
    js/panels.js          the six tabs and the knob and fader widgets
    js/app.js             state, deck, transport, themes and layouts, boot
    js/offline.js         service worker registration and download panel
    samples/              your own sounds (Route 2). Excluded from git.
    icons/
  tools/convert_samples.sh   WAV folder to web/samples (FLAC) and catalogue
  tools/make_catalogue.py
  tests/
```

## Development

There is no build. Edit files in `web/` and reload.

- Tests: `node --test tests/` checks the data model, including loading of bad project files. `EP133_URL=<address> uv run --with playwright python tests/browser_test.py` drives the real page (playback, song recording, undo, note repeat, offline reload) and needs a sample set installed. `tests/phone_test.py` checks the phone layouts and `tests/look_test.py` checks the themes and the HARDWARE layout. `tests/nosounds_test.py` runs the app with no sounds installed and tests multi-file import, and needs no sample set.
- Service worker: bump `VERSION` in `web/sw.js` when you add or rename files, and add new files to its `ASSETS` list.
- Data on the device: projects are in `localStorage` under `ko.proj.N`, settings under `ko.settings`, and imported or recorded sounds in the IndexedDB database `ko-samples`.
- Themes are CSS custom properties set by `data-theme` on `<html>` (see the top of `web/style.css`). The HARDWARE layout is the `.lay-hw` block at the end of the same file.

## Known limits

- Tested in headless Chromium (audio engine, sequencer timing, recording, offline reload) and in layout at iPad and iPhone sizes. It has not been run on a physical iPad, iPhone or in Safari.
- Audio latency on Web Audio is typically 10 to 30 ms on iPad. It is fine for step programming and acceptable for finger drumming, but not equal to a hardware sampler.
- Not included: time-stretch, MIDI in and out, sync to other devices, sidechain, live input effects, pressure-sensitive pads, USB transfer, and the hardware's exact punch-in effect set.
- An iPad has no pressure-sensitive pads. In PROJECT, PAD VELOCITY can use the touch position on the pad instead.
