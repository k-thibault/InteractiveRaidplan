# MMO Mechanics Training Simulator

## Overview

A browser-based 2D training simulator for practicing MMO encounter mechanics. The current app uses a top-down canvas arena with a player-controlled character, a boss, scripted players, telegraphed attacks, statuses, and fatal damage.

Encounters are described in JSON rather than hardcoded in the UI. The example encounter demonstrates:

- absolute and relative timeline events
- seeded random target selection
- role and status selectors
- circle and cone area telegraphs
- one-shot area resolution with player-count conditions
- typed damage and status-based vulnerability
- status expiration and player health
- encounter-scoped random groups with reusable references
- stateful cyclic sequences with randomized starts and deterministic progression
- resolution-scoped distributions assigned across mechanic participants
- declarative mechanical roles evaluated at explicit timeline events
- bot position targets and movement for uncontrolled players
- timed casts with visible cast bars and completion effects
- unified status removal and expiration with removal-triggered effects
- controlled-player health display and encounter event logging

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

The interface includes the loaded encounter name, start/pause/resume, restart, speed controls, and a control selector. The selector can choose any encounter player or `All bots`. Players can move with WASD or arrow keys when controlled. The controlled player's health is shown with a max-health-scaled bar and critical-state colors. Events affecting the controlled player, including damage and status application, appear in a timestamped event log. Active statuses appear as small badges beside entities; hovering a badge displays the status name. The arena and event log stack vertically on narrow screens.

Encounter players have one gameplay `role` (`tank`, `healer`, or `damage`) and an independent `mechanicalRoles` array. `controlled` is runtime state derived from `SimulationOptions.controlledPlayerId`, so encounter JSON can be reused for human-controlled and all-bot runs. Omit the option to run every player as a bot.

Mechanical roles are declared under `mechanicalRoles`. A role contains rules using status, gameplay-role, mechanical-role, boolean, and cross-player conditions. `recalculate_roles` evaluates every player from the same prior state and commits the complete assignment together, avoiding order-dependent results.

Bot positioning is also event-driven. A player may declare a fixed or player-relative `positionTarget`; `recalculate_positions` resolves targets for uncontrolled players and skips the controlled player. `BotManager` then moves each bot toward its desired position at its configured move speed. This keeps role assignment, positioning intent, and movement as separate systems.

Casts are declared under `casts` and contain an immutable name, cast time, visibility flag, and completion effects. A `start_cast` event or effect creates an `ActiveCast` in `GameState`; the simulation resolves it when its completion time is reached. Visible active casts appear in the arena cast bar. Cast effects use the same effect pipeline as timeline mechanics, including area spawning, damage, status application, status removal, and nested casts.

Statuses now have an optional `onRemove` effect list. `remove_status` events, explicit removal effects, and natural expiration all use the same removal path, so removal-triggered effects behave consistently. The example encounter demonstrates a timed `volatile` status that starts a cast when it expires, as well as a boss `Flamefrost` cast.

Status definitions, area success/failure effects, named random groups, named sequences, and distributions are part of the encounter data. Shuffle groups are randomized once per encounter and can be referenced from multiple events with `$group.0` or `$group[0]`. Sequences define `values`, a `start` index or random start, and a numeric `step`; a direct reference such as `$sequence` returns the current value, advances the sequence, and wraps at either end. Random sequence choices are made once when the simulation starts, so later requests remain deterministic. Distributions preserve a multiset of `values` by shuffling it when an `assign_distribution` effect resolves. The effect assigns one value to each resolved participant, so duplicate values and `null` outcomes are preserved; assigned values can be referenced as `$assignedValue` or `$assignedValue.property`. The simulation also stores timestamped log entries for controlled-player damage and status changes. The example encounter is located at `public/encounters/example.json`.

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
### Selector targets in cast effects

Effect targets may now be either an area target (`inside`, `outside`, `all`) or a `PlayerSelector`. This lets cast effects such as `apply_status` select a specific random player instead of accidentally treating selector objects as an area target.
