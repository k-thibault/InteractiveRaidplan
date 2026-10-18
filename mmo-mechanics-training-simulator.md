# MMO Mechanics Training Simulator

## Overview

A browser-based 2D sandbox for practicing MMO encounter mechanics. Choose a timeline, control a player or let the party run on bots, and observe attacks, movement, statuses, and damage in a top-down arena.

Encounters combine scripted events with reusable mechanics such as area telegraphs, casts, role assignments, bot positioning, status effects, knockbacks, and seeded random choices. Runs can be repeated with the same random outcomes for comparison.

## Using the simulator

1. Choose an encounter from **Timeline**.
2. Choose a player from **Control**, or select **All bots**. Move the controlled player with **WASD** or the **arrow keys**. Enable **Face cursor when still** (in **Run options**) to aim toward the pointer while stationary.
3. Select **Start** to begin. Use the same button to pause or resume.
4. Use **Restart** to start a new attempt. By default, it uses a new random seed; enable **Keep previous RNG** in **Run options** to replay the current seed.
5. Choose a simulation speed from **0.5x** to **4x**.
6. Choose which kind of shotcalls will be simulated for the chosen encounter in **Run options**: **Text**, **TTS**, or both.

## Reading the arena

The arena displays players, enemies, markers, attack areas, and active cast bars. The controlled player is highlighted. The party roster shows health and active statuses; hover a status badge to see its name. Events affecting the controlled player, including damage and status changes, appear in the timestamped **Event Log**.

## Features

- Selectable encounter timelines with scripted phases and timed mechanics.
- Circle, cone, and donut attacks, casts, markers, arena boundaries, and visual resources.
- Player health, status effects and stacks, damage, control effects, and forced movement.
- Bot movement and role-based positioning to simulate the rest of the party.
- Randomized mechanics with repeatable runs through the seed control.
- Tethers linking entities, with passing, break conditions, and length-based styling.
- Ability to hide other bots while controlling a player.
- Replays of every attempt: watch, seek, save, load and retry an attempt (see below).
- A streak counter of successive successful runs, including runs with bots hidden by a player.
- Responsive layout for the arena, party roster, and event log.

## Dev build features

**Batch simulate** plays through the encounter with all bots active a configurable number of times and reports the number of runs that ended with bots alive/dead. Categorizes the runs that failed by different metrics,
useful for making sure a new timeline has reliable bot logic before release.
**Debug log** prints out raw events for all bots to the log during the run, including normally hidden information like mechanical role decisions and hidden status applications.

## Replays

Every attempt is recorded automatically. Playback reruns the same encounter using its seed, random outcomes, and your recorded movement and facing, so the party responds as it did in the original run.

- Watch the latest attempt, seek through it, or retry with the same random outcomes. Replay controls do not affect your streak.
- The **Replay** menu holds watching the last attempt, saving, loading and the history. While watching, the header shows the replay details and seek bar, and **Run options** switch to the app defaults (shotcalls on, bots visible) until you exit.
- A run ends as a failure three seconds after every player has died, and its replay is listed as failed rather than abandoned.
- Replays record the streak-affecting options they were played with (bots hidden, shotcalls off) and show the streak a success would have earned, such as "Zero help", next to the seed and result.
- Save and load replay files. Playback warns if the encounter or simulator has changed and reports when the result diverges.
- History keeps this session's attempts until cleared and removes older sessions after 24 hours. If browser storage is unavailable, history lasts until the tab closes.
- In development builds, failed seeds from **Batch simulate** can be opened in the replay viewer.

### Notes for timeline authors

Add a facing rule whenever a mechanic depends on the controlled player's facing; development builds warn when facing is read outside a rule. Increase `SIM_VERSION` in `src/replay/format.ts` when simulation behavior changes so old recordings can warn before playback.

Add a unique `replayId` to random mechanic draws that depend on attempt state. Supported draws include status distributions, random group selection, cast choices, and opted-in random targets/facing. Repeated executions of one id are stored separately. Run `npx tsx scripts/check-replay-ids.ts` to check shipped encounters.

### Checks

`npm run check` runs every script below (`npm run check:quick` skips the slow replay and prodready ones). They can also be run one at a time with `npx tsx`:

```sh
npx tsx scripts/check-foundation.ts   # deterministic scripted runs, bot-track parity
npx tsx scripts/check-replay.ts       # record, serialise, replay, tamper detection, safety net
npx tsx scripts/check-viewer.ts       # attempt history, viewer, seeking, retry
npx tsx scripts/check-history.ts      # history storage and purge rules
npx tsx scripts/check-replay-ids.ts  # replay ID coverage and pinning
npx tsx scripts/check-geometry.ts     # collision shapes, facing, quantization, arena borders
npx tsx scripts/check-core.ts         # random stream, scheduler, damage, streaks, run options
npx tsx scripts/check-simulation.ts   # timeline, statuses, casts, areas, knocks, bots
npx tsx scripts/check-encounters.ts   # encounter data references and smoke runs
npx tsx scripts/check-prodready.ts    # 500 all-bots attempts per prodready encounter must clear
```

## Encounter library

The timeline list is maintained in `public/encounters/index.json`. Development builds show all listed encounters; production builds include entries marked ready for release. Encounter files and shared visual resources are stored under `public/encounters/` and `public/resources/`.

## Development

```sh
npm install
npm run dev
npm run build
npm run preview
```
