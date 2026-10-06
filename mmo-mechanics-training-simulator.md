# MMO Mechanics Training Simulator

## Overview

A browser-based 2D sandbox for practicing MMO encounter mechanics. Choose a timeline, control a player or let the party run on bots, and observe attacks, movement, statuses, and damage in a top-down arena.

Encounters combine scripted events with reusable mechanics such as area telegraphs, casts, role assignments, bot positioning, status effects, knockbacks, and seeded random choices. Runs can be repeated with the same random outcomes for comparison.

## Using the simulator

1. Choose an encounter from **Timeline**.
2. Choose a player from **Control**, or select **All bots**. Move the controlled player with **WASD** or the **arrow keys**. Enable **Face cursor when still** to aim toward the pointer while stationary.
3. Select **Start** to begin. Use the same button to pause or resume.
4. Use **Restart** to start a new attempt. By default, it uses a new random seed; enable **Keep previous RNG** to replay the current seed.
5. Choose a simulation speed from **0.5x** to **4x**.
6. Choose which kind of shotcalls will be simluated for the chosen encounter: **Text**, **TTS**, or both.

## Reading the arena

The arena displays players, enemies, markers, attack areas, and active cast bars. The controlled player is highlighted. The party roster shows health and active statuses; hover a status badge to see its name. Events affecting the controlled player, including damage and status changes, appear in the timestamped **Event Log**.

## Features

- Selectable encounter timelines with scripted phases and timed mechanics.
- Circle, cone, and donut attacks, casts, markers, arena boundaries, and visual resources.
- Player health, status effects and stacks, damage, control effects, and forced movement.
- Bot movement and role-based positioning to simulate the rest of the party.
- Randomized mechanics with repeatable runs through the seed control.
- Ability to hide other bots while controlling a player.
- A steak counter of successive successful runs, and successful runs with bots hidden by a player.
- Responsive layout for the arena, party roster, and event log.

## Dev build features

**Batch simulate** plays through the encounter wiht all bots active a configurable number of times and reports the number of runs that ended with bots alive/dead. Categorizes the runs that failed by different metrics,
useful for making sure a new timeline has reliable bot logic before release.
**Debug log** prints out raw events for all bots to the log during the run, including normally hidden information like mechanical role decisions and hidden status applications.

## Encounter library

The timeline list is maintained in `public/encounters/index.json`. Development builds show all listed encounters; production builds include entries marked ready for release. Encounter files and shared visual resources are stored under `public/encounters/` and `public/resources/`.

## Development

```sh
npm install
npm run dev
npm run build
npm run preview
```
