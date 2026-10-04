# MMO Mechanics Training Simulator

## Overview

A browser-based 2D training simulator for practicing MMO encounter mechanics. The current app uses a top-down canvas arena with a player-controlled character, a boss, scripted players, telegraphed attacks, statuses, and fatal damage.

Encounters are described in JSON rather than hardcoded in the UI. The example encounter demonstrates:

- absolute and relative timeline events
- seeded random target selection
- role and status selectors
- circle, cone, and donut area telegraphs
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
- styled entity markers and custom soak telegraphs
- reusable named area definitions and area tags for bot positioning
- grouped area resolution that combines unique participants across multiple telegraphs
- stacked statuses with capped application, partial removal, and visible stack counts
- root and stun statuses, knocks, and a boss follow mode (see the `Movement Effects` encounter)

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

Area definitions can exclude their source entity from resolution, can be reused by name, and can select named telegraph styles; the current renderer provides a `soak` gradient. Spawned areas can carry tags for position targeting and can belong to an area group that collects unique participants across a configured number of resolved areas before running shared effects. Entities can use a filled circle or ring style with world-unit dimensions.

Casts are declared under `casts` and contain an immutable name, cast time, visibility flag, and completion effects. A `start_cast` event or effect creates an `ActiveCast` in `GameState`; the simulation resolves it when its completion time is reached. Visible active casts appear in the arena cast bar. Cast effects use the same effect pipeline as timeline mechanics, including area spawning, damage, status application, status removal, nested casts, and delayed effect batches. Area definitions can provide separate `telegraphColor` and `executionColor` values; the renderer uses the telegraph color before resolution and the execution color after resolution.

Statuses now have an optional `onRemove` effect list and an optional `maxStacks` cap. `apply_status` and `remove_status` can add or remove a specific number of stacks; capped statuses are stored as one instance and the renderer shows their current stack count. Events, explicit removal effects, and natural expiration all use the same removal path, so removal-triggered effects behave consistently. The `Forsaken` encounter uses `Spells Trouble` stacks during its soak cycle and retains its randomized damage/non-damage trigger assignment before distributing those triggers.

Encounters declare named graphics under `resources.graphics`. `EncounterLoader` resolves those names through the shared `public/resources/graphics.json` library into image URLs. An encounter's `background` names the initial arena image, changeable mid-timeline with a `set_background` event. A status's `icon` swaps its default colored badge for an image, in both the arena and the roster. A `show_graphic` event or effect displays a timed image at a fixed position or tracked to an entity; this is separate from the cast bar and is used for things like a brief flash on a status's target via `onApply`, or a ground marker that telegraphs an upcoming mechanic.

Status definitions, area success/failure effects, named random groups, named sequences, and distributions are part of the encounter data. Shuffle groups are randomized once per encounter and can be referenced from multiple events with `$group.0` or `$group[0]`. Sequences define `values`, a `start` index or random start, and a numeric `step`; a direct reference such as `$sequence` returns the current value, advances the sequence, and wraps at either end. Random sequence choices are made once when the simulation starts, so later requests remain deterministic. Distributions preserve a multiset of `values` by shuffling it when an `assign_distribution` effect resolves. The `distribute_statuses` effect independently shuffles selected players and a status list, pairing one status with each participant. Assigned values can be referenced as `$assignedValue` or `$assignedValue.property`. The simulation also stores timestamped log entries for controlled-player damage and status changes. The example encounters are located at `public/encounters/example.json` and `public/encounters/forsaken.json`.

Statuses can set `control: "root"` or `control: "stun"`. A root blocks regular movement; a stun also blocks facing changes, including keyboard/cursor facing, bot facing, and `recalculate_facing` rules (a stunned entity is skipped entirely). The block is enforced where movement happens (`PlayerController`, `BotManager`, `FollowManager`), so bot AI can keep choosing destinations. A rooted player or bot that tries to move still turns toward that direction.

`knock` is an effect and event that gives a player a forced movement with a fixed heading: `direction` is `{ "type": "radial", "from"?: entityId | position }` (away from the point; defaults to the effect's source) or `{ "type": "linear", "angle": degrees }` (compass heading). `distance` is covered in `duration` ms (default 500), so larger knocks move faster. Regular movement is disabled until the knock ends and resumes immediately after unless a root or stun is active. Knocks ignore roots and stuns and are clamped to the arena. A knock resolved by an area defaults its radial origin to the area's center. `facingModifiers` rescales the knock for targets holding a status, based on whether they face the knock's source (`towards`) or directly away from it (`away`) within a cone `arc` degrees wide (default 90); `consume` removes the status when a multiplier applies, and facings between the cones leave the knock and status unchanged.

The `donut` area shape uses `radius` as the outer edge and `innerRadius` as the safe hole.

`start_follow` and `stop_follow` (effects or events) toggle follow mode on a non-player entity (`source`, default `boss`). A follower walks toward its `target` (an entity reference, e.g. the tank role) at `moveSpeed` until it is within `distance`, and faces the target each tick unless a `facing` rule is active. Casts can set `suspendFollow: { "movement": true, "facing": true }` to pause either part while the cast bar is active; following resumes when the cast completes.

Status hooks: `onRemove` runs on any removal, `onExpire` only on timeout, and `onEarlyRemove` only when removed before timing out. With `reassignIfDead`, a dead carrier's `onRemove` effects run on a random living player instead. Effects with `target: \"source\"` hit the effect's source entity, which for these hooks is the status carrier. In an area's resolution, `inside_others` is `inside` without the entity the area is anchored to (its `source`).

`batches` collect `add_to_batch` effects: the first call opens a `window` (default 500 ms), and when it closes the batch's `effects` run once with `$batchCount` set to the number of calls collected. Calls arriving after the window closes start a new batch.

Selectors: `nearest` accepts `role`/`roles`, and `random` accepts `from` (another selector) to restrict its pool. `apply_status` accepts `statusChoices` to roll a status independently per target. `spawn_enemy` accepts `enemyId` for a fixed id. Entity `style` supports `diamond`, `square` and `triangle` markers and a `color` override.

Role `has_status`/`not_has_status` conditions resolve random-group references, so a role can depend on a per-attempt roll. Position targets add `polar.angleFrom` (use an entity's bearing instead of a fixed angle) and `between` (a point on the line between two entities). The `drag` target picks where a bot should stand so a following entity ends up on a chosen spot: past the goal, on the side away from the entity, by its follow distance (or an explicit `distance`). The result depends on where the entity is now, so a position rule can set `live: true` to be re-resolved every tick while the entity catches up; without it the spot is fixed when the group is recalculated.

The `Crystal Division (scaffold)` encounter exercises all of the above.

The Crystal encounter continues through Thunder III. Its dice only decide what is actually random: `windDiagonal` (which diagonal the wind crystal is on), `fireRotation` (whether fire sits clockwise or counterclockwise of wind, with water on the other side) and `debuffTiming` (fire short or water short). Everything else is worked out from where the crystals and markers currently are: the short number is the marker nearest the short crystal, the short letter is the one further from wind of the 2nd and 3rd closest markers to it, and the small tank drags Exdeath to the long crystal's bearing turned 10 degrees away from wind. `crystal-setup` handles the initial placement and `crystal-thunder` switches players to their Thunder markers and debuff positions.

Dynamic lookups: `${group.field}` splices a rolled value into text (`"${debuffTiming.shortElement}-crystal"`); `$add`/`$sub`/`$mul`/`$neg` objects do arithmetic on rolled numbers; polar positions take an `angleOffset`. A polar position target can take its angle from an entity (`angleFrom`) and turn it toward another entity's bearing (`angleTowards`, negative `by` turns away); `edge` targets take `angleFrom` too. Marker targets take either an `id` or a `query`: `{ from, ids?, ranks?, farthestFrom? | nearestTo? }` ranks the markers by distance from a point, keeps the wanted zero-based ranks and picks one, and queries can be named under the encounter's `markerQueries`. Inside a `shift`, a query with no `from` ranks from the point being shifted. A facing target `bearing` faces the compass heading of any position target. Marker ids and query names are validated when an encounter loads.

Effect targets may be either an area target (`inside`, `outside`, `all`) or a `PlayerSelector`. This lets effects such as `apply_status` select a specific random player without treating the selector as an area target. Mechanical-role conditions also support `player_condition`, which checks whether a player reference (`self`, an id, a gameplay role, or a mechanical role) satisfies another condition. In the example encounter, overload handling uses this to assign fire- and frost-specific roles only when the matching damage player has the corresponding overload status; other roles remain gated by the active mechanic and relevant statuses.

Encounters can declare an `arena`: `{ "shape": "circle" | "square" | "rectangle", "radius" | "size" | "width"+"height", "edge": "wall" | "deadly" }`, centred on the origin. Omitting it keeps the legacy 28x18 walled rectangle. A `wall` edge stops players, bots and knocks at the border; a `deadly` edge lets them cross it and kills anything past the border (travel is capped 1.5 units beyond so nobody wanders off). Bots never path past a deadly border (they stop 0.3 short), and followers (bosses) are always clamped inside. The renderer clips the floor, grid, markers and telegraphs to the arena shape, draws everything outside as a dark hatched void, and strokes the border (red glow when deadly, grey when a wall). `Crystal Division` uses a deadly 20x20 square and `Forsaken` a deadly radius-10 circle. Position rules can use `{ "type": "edge", "angle", "inset"?, "origin"? }` to stand where a compass ray meets the border.

The Crystal encounter continues past the first Thunder III: 3 s after the short debuffs resolve everyone is healed and Exdeath casts `thunder-bait` (5 s), which hits the nearest player with a wind-soak-sized circle and again 2 s later. The small tank baits under Exdeath while the large tank drags Chaos to the middle; between the hits the tanks swap (`tank-swap` roles, Chaos re-follows the new large tank, Exdeath follows the new small tank after hit two) and the new large tank then walks to face Chaos north of the A marker. Chaos then rolls `chaosCast` (`chaos-frontback` or `chaos-sides`, 5 s, ending 4 s before the long debuffs expire): 90 degree cones on the first axis, 1.5 s later on the other. Bots hold their diagonals, shift toward B/D or A/C (`chaos-shift-bd` / `chaos-shift-ac`, ordered by the roll) and the long and wind supports run to the edge once the second hit lands (`chaos-edge`).

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
