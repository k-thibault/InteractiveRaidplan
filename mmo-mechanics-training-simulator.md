# MMO Mechanics Training Simulator

## Overview

A browser-based 2D training simulator for practicing MMO encounter mechanics. The current app uses a top-down canvas arena with a player-controlled character, a boss, scripted players, telegraphed attacks, statuses, and fatal damage.

Encounters are described in JSON rather than hardcoded in the UI. The example encounter demonstrates:

- absolute and relative timeline events
- seeded random target selection
- role and status selectors
- circle and cone area telegraphs
- configurable telegraph and execution colors for area effects
- one-shot area resolution with player-count conditions
- typed damage and status-based vulnerability
- status expiration and player health
- encounter-scoped random groups with reusable references
- stateful cyclic sequences with randomized starts and deterministic progression
- resolution-scoped distributions assigned across mechanic participants
- declarative mechanical roles evaluated at explicit timeline events
- player-aware mechanical-role conditions that inspect another matching player
- bot position targets and movement for uncontrolled players
- timed casts with visible cast bars and completion effects
- unified status removal and expiration with removal-triggered effects
- controlled-player health display and encounter event logging
- resource-based arena backgrounds, status icons, and timed world graphics
- multiple selectable encounter timelines, including the `Forsaken` encounter
- team- and damage-position-aware role assignments
- delayed effects and rotation-based random groups

## Architecture

```text
Encounter JSON -> Loader -> Scheduler -> GameState -> Renderer
          |              |       ^  ^
          v              v       |  |
         Mechanics     Role/position  Input
                evaluators     |
                  |          |
                  v          v
                Bot manager  Human controller
```

`GameState` is the source of truth. Simulation logic is independent of rendering, and the renderer only displays state. Simulation time advances in fixed steps and random choices use a seeded RNG for reproducible runs.

## Current implementation

The project is a TypeScript/Vite application with these main modules:

```text
src/
  bots/         BotManager, mechanical roles, position targets and evaluator
  simulation/   GameState, Simulation, Scheduler, Random, RandomContext
  entities/     Entity, Player, Enemy, Status
  geometry/     Vector2, circles, cones, collision helpers
  mechanics/    Events, casts, selectors, effects, area and damage resolvers
  encounters/   Encounter types and JSON loader
  input/        Keyboard player controller
  rendering/    Canvas arena renderer
```

The interface includes the loaded encounter name, start/pause/resume, restart, speed controls, and a control selector. The selector can choose any encounter player or `All bots`. Players can move with WASD or arrow keys when controlled. In the arena, the controlled player renders blue and other players green. A roster panel to the left of the arena shows every player's health, max-health-scaled bars, and critical-state colors, with the controlled player's row pinned to the top; each row has a fixed-size status column so active statuses (and a countdown for non-permanent ones) never change the row's height. Enemies still show status badges beside them on the field; the controlled player's own statuses instead render enlarged at the bottom-center of the arena. Hovering a status badge, in the roster or the arena, displays the status name. Events affecting the controlled player, including damage and status application, appear in a timestamped event log. The arena, roster, and event log stack vertically on narrow screens.

Each new attempt receives a random seed. Restarting or changing the controlled player creates a new randomized attempt by default; enabling `Keep previous RNG` reuses the current seed so the same randomized encounter can be replayed. The renderer receives status definitions from the encounter, including optional badge characters and colors.

The app loads an encounter manifest from `public/encounters/index.json` and exposes the listed timelines through the Timeline selector. Encounter players have one gameplay `role` (`tank`, `healer`, or `damage`) and an independent `mechanicalRoles` array. `controlled` is runtime state derived from `SimulationOptions.controlledPlayerId`, so encounter JSON can be reused for human-controlled and all-bot runs. Omit the option to run every player as a bot.

Mechanical roles are declared as named groups under `mechanicalRoles`. Each group maps role names to conditions, and `recalculate_roles` can select the group needed by the current mechanic. Conditions support status, gameplay role, damage position, team, mechanical role, active cast/area, boolean, compact array-as-AND, and cross-player predicates such as `team_partner`. Assignments are calculated from the same prior state and committed together. The `Forsaken` encounter uses trigger assignments to select different stack, cone, and spread mechanics for damage and non-damage players.

Bot positioning is also event-driven and grouped under `positions`. A player may declare a fixed, player-relative, active-area, or polar `positionTarget`; `recalculate_positions` can select the group needed by the current mechanic and skips the controlled player. Position targets can resolve named random values, area labels, role references, and polar coordinates. `BotManager` moves each bot toward its desired position at its configured move speed.

Casts are declared under `casts` and contain an immutable name, cast time, visibility flag, and completion effects. A `start_cast` event or effect creates an `ActiveCast` in `GameState`; the simulation resolves it when its completion time is reached. Visible active casts appear in the arena cast bar. Cast effects use the same effect pipeline as timeline mechanics, including area spawning, damage, status application, status removal, nested casts, and delayed effect batches. Area definitions can provide separate `telegraphColor` and `executionColor` values; the renderer uses the telegraph color before resolution and the execution color after resolution.

Statuses now have an optional `onRemove` effect list. `remove_status` events, explicit removal effects, and natural expiration all use the same removal path, so removal-triggered effects behave consistently. The example encounter demonstrates a timed `volatile` status that starts a cast when it expires, as well as a boss `Flamefrost` cast.

Encounters declare named graphics under `resources.graphics`. `EncounterLoader` resolves those names through the shared `public/resources/graphics.json` library into image URLs. An encounter's `background` names the initial arena image, changeable mid-timeline with a `set_background` event. A status's `icon` swaps its default colored badge for an image, in both the arena and the roster. A `show_graphic` event or effect displays a timed image at a fixed position or tracked to an entity; this is separate from the cast bar and is used for things like a brief flash on a status's target via `onApply`, or a ground marker that telegraphs an upcoming mechanic.

Status definitions, area success/failure effects, named random groups, named sequences, and distributions are part of the encounter data. Shuffle groups are randomized once per encounter and can be referenced from multiple events with `$group.0` or `$group[0]`. Sequences define `values`, a `start` index or random start, and a numeric `step`; a direct reference such as `$sequence` returns the current value, advances the sequence, and wraps at either end. Random sequence choices are made once when the simulation starts, so later requests remain deterministic. Distributions preserve a multiset of `values` by shuffling it when an `assign_distribution` effect resolves. The `distribute_statuses` effect independently shuffles selected players and a status list, pairing one status with each participant. Assigned values can be referenced as `$assignedValue` or `$assignedValue.property`. The simulation also stores timestamped log entries for controlled-player damage and status changes. The example encounters are located at `public/encounters/example.json` and `public/encounters/forsaken.json`.

Effect targets may be either an area target (`inside`, `outside`, `all`) or a `PlayerSelector`. This lets effects such as `apply_status` select a specific random player without treating the selector as an area target. Mechanical-role conditions also support `player_condition`, which checks whether a player reference (`self`, an id, a gameplay role, or a mechanical role) satisfies another condition. In the example encounter, overload handling uses this to assign fire- and frost-specific roles only when the matching damage player has the corresponding overload status; other roles remain gated by the active mechanic and relevant statuses.

## Development

```text
npm install
npm run dev
npm run build
```

## Next steps

- Add encounter validation, richer area conditions, and phase-scoped random values, sequences, and distributions.
- Support additional area shapes and effect types, including richer cast targeting and delayed cast sub-effects.
- Expand position targets with room edges, areas, and geometric constraints; add obstacle-aware movement.
- Add deterministic replay and failure analysis.
- Build a visual encounter editor once the engine vocabulary is stable.
