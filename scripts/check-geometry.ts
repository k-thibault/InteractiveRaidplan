// Guards the geometry primitives every mechanic and bot builds on.
// Run with: npx tsx scripts/check-geometry.ts
import { pointInCircle, pointInCone, pointInDonut, pointInLine } from '../src/geometry/Collision';
import { clampDirection, isValidDirectionClamp, snapHeading } from '../src/geometry/DirectionClamp';
import { angleDelta, isFacingAway, isFacingTowards, signedAngleDelta } from '../src/geometry/Facing';
import { fromFacingUnits, fromPositionUnits, quantizeFacing, quantizePosition, toFacingUnits, toPositionUnits } from '../src/geometry/Quantize';
import { circularMeanAngle, fromPolar, toPolarAngle } from '../src/geometry/Vector2';
import { clampToArena, constrainToArena, distanceToArenaEdge, DEADLY_EDGE_OVERSHOOT, isInsideArena, resolveArena, validateArenaDefinition } from '../src/geometry/Arena';

let failures = 0;
function check(name: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures += 1; }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const throws = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
const O = { x: 0, y: 0 };

// Compass headings: 0 is north (-y), 90 is east (+x), clockwise.
{
  const north = fromPolar(0, 5); const east = fromPolar(90, 5);
  check('fromPolar 0 points north (-y)', near(north.x, 0) && near(north.y, -5));
  check('fromPolar 90 points east (+x)', near(east.x, 5) && near(east.y, 0));
  check('toPolarAngle inverts fromPolar', [0, 30, 90, 179, 180, 271, 359].every((deg) => near(toPolarAngle(fromPolar(deg, 3)), deg, 1e-7)));
  check('toPolarAngle is relative to the origin', near(toPolarAngle({ x: 2, y: 3 }, { x: 2, y: 5 }), 0));
  check('circularMeanAngle wraps across north', near(circularMeanAngle([350, 10]), 0, 1e-7) || near(circularMeanAngle([350, 10]), 360, 1e-7));
}

// Areas
{
  check('circle includes its edge, excludes beyond', pointInCircle({ x: 3, y: 4 }, O, 5) && !pointInCircle({ x: 3, y: 4.01 }, O, 5));
  check('donut is inclusive on both radii', pointInDonut({ x: 2, y: 0 }, O, 2, 4) && pointInDonut({ x: 4, y: 0 }, O, 2, 4) && !pointInDonut({ x: 1.9, y: 0 }, O, 2, 4) && !pointInDonut({ x: 4.1, y: 0 }, O, 2, 4));
  // Cones and lines use math radians (0 = +x); `angle` is the full cone width in degrees.
  check('cone covers half its angle each side', pointInCone({ x: 3, y: 1 }, O, 0, 5, 90) && !pointInCone({ x: 3, y: 4 }, O, 0, 5, 90));
  check('cone respects radius and wraps around +-pi', !pointInCone({ x: 6, y: 0 }, O, 0, 5, 90) && pointInCone({ x: -3, y: 0.2 }, O, Math.PI, 5, 30) && pointInCone({ x: -3, y: -0.2 }, O, -Math.PI, 5, 30));
  check('line is a rectangle from the origin', pointInLine({ x: 5, y: 0.9 }, O, 0, 10, 2) && !pointInLine({ x: 5, y: 1.1 }, O, 0, 10, 2) && !pointInLine({ x: -0.1, y: 0 }, O, 0, 10, 2) && !pointInLine({ x: 10.1, y: 0 }, O, 0, 10, 2));
  check('line start skips the near end', !pointInLine({ x: 2, y: 0 }, O, 0, 10, 2, 3) && pointInLine({ x: 3, y: 0 }, O, 0, 10, 2, 3));
  check('line follows its rotation', pointInLine({ x: 0, y: 5 }, O, Math.PI / 2, 10, 2) && !pointInLine({ x: 5, y: 0 }, O, Math.PI / 2, 10, 2));
}

// Facing
{
  check('angleDelta takes the short way round', angleDelta(350, 10) === 20 && angleDelta(10, 350) === 20 && angleDelta(0, 180) === 180 && angleDelta(90, 90) === 0);
  check('signedAngleDelta sign is clockwise-positive', signedAngleDelta(350, 10) === 20 && signedAngleDelta(10, 350) === -20 && signedAngleDelta(0, 180) === 180 && signedAngleDelta(180, 0) === 180);
  check('facing towards / away with default 90 tolerance', isFacingTowards(O, 0, { x: 0, y: -5 }) && isFacingAway(O, 0, { x: 0, y: 5 }) && isFacingTowards(O, 0, { x: 5, y: 0 }) && !isFacingAway(O, 0, { x: 5, y: 0 }));
  check('facing a target on the same spot counts as towards', isFacingTowards({ x: 1, y: 1 }, 123, { x: 1, y: 1 }));
}

// Direction clamps
{
  check('cardinal snaps to 0/90/180/270', snapHeading(44, 'cardinal') === 0 && snapHeading(46, 'cardinal') === 90 && snapHeading(359, 'cardinal') === 0 && snapHeading(-10, 'cardinal') === 0);
  check('intercardinal snaps to the diagonals', snapHeading(10, 'intercardinal') === 45 && snapHeading(200, 'intercardinal') === 225);
  check('eight-way and custom steps', snapHeading(20, 'eight-way') === 0 && snapHeading(25, 'eight-way') === 45 && snapHeading(70, { step: 60, offset: 10 }) === 70);
  const clamped = clampDirection({ x: 0.2, y: -1 }, 'cardinal');
  check('clampDirection returns clean unit vectors (no -0 or 1e-17)', clamped.x === 0 && clamped.y === -1);
  check('clampDirection keeps a zero vector', clampDirection(O, 'cardinal') === O);
  check('clamp validation', isValidDirectionClamp('cardinal') && isValidDirectionClamp({ step: 30 }) && !isValidDirectionClamp('diagonal') && !isValidDirectionClamp({ step: 0 }) && !isValidDirectionClamp({ step: 400 }) && !isValidDirectionClamp(null));
}

// Quantization (recordings depend on exact, lossless round trips)
{
  check('position units round trip', [0, 1.2345, -7.6543, 13.9999].every((value) => fromPositionUnits(toPositionUnits(value)) === value));
  check('negative zero never survives quantization', Object.is(fromPositionUnits(toPositionUnits(-0.00001)), 0) && Object.is(toPositionUnits(-0.00001), 0));
  check('facing wraps into [0, 360)', quantizeFacing(-90) === 270 && quantizeFacing(360) === 0 && quantizeFacing(359.999) === 0 && quantizeFacing(725) === 5);
  check('facing units round trip', [0, 0.01, 123.45, 359.99].every((degrees) => fromFacingUnits(toFacingUnits(degrees)) === degrees));
  const position = { x: 1.23456789, y: -2.98765432 }; quantizePosition(position);
  check('quantizePosition snaps in place', position.x === 1.2346 && position.y === -2.9877);
}

// Arena
{
  const rectangle = resolveArena();
  check('default arena is the legacy 28x18 walled rectangle', rectangle.shape === 'rectangle' && rectangle.halfWidth === 14 && rectangle.halfHeight === 9 && rectangle.edge === 'wall');
  const circle = resolveArena({ shape: 'circle', radius: 10 });
  const square = resolveArena({ shape: 'square', size: 20, edge: 'deadly' });
  check('circle and square sizes resolve', circle.radius === 10 && square.halfWidth === 10 && square.halfHeight === 10 && square.edge === 'deadly');
  check('isInsideArena per shape', isInsideArena(rectangle, { x: 14, y: 9 }) && !isInsideArena(rectangle, { x: 14.5, y: 0 }) && isInsideArena(circle, { x: 6, y: 8 }) && !isInsideArena(circle, { x: 8, y: 8 }));
  const outside = { x: 30, y: -20 }; clampToArena(outside, rectangle);
  check('clampToArena pins a box corner', outside.x === 14 && outside.y === -9);
  const round = { x: 30, y: 40 }; clampToArena(round, circle);
  check('clampToArena keeps the direction on a circle', near(Math.hypot(round.x, round.y), 10) && near(round.x / round.y, 0.75));
  const inset = { x: 14, y: 0 }; clampToArena(inset, rectangle, 1);
  check('clampToArena inset shrinks the arena', inset.x === 13);
  const wall = { x: 20, y: 0 }; constrainToArena(wall, rectangle);
  const edge = { x: 40, y: 0 }; constrainToArena(edge, square);
  check('wall stops at the border, deadly edge allows a bounded overshoot', wall.x === 14 && near(edge.x, 10 + DEADLY_EDGE_OVERSHOOT));
  check('distanceToArenaEdge for box and circle', near(distanceToArenaEdge(rectangle, O, { x: 1, y: 0 }), 14) && near(distanceToArenaEdge(rectangle, { x: 10, y: 0 }, { x: 1, y: 0 }), 4) && near(distanceToArenaEdge(circle, { x: 5, y: 0 }, { x: 1, y: 0 }), 5) && near(distanceToArenaEdge(circle, { x: 5, y: 0 }, { x: -1, y: 0 }), 15));
  check('arena validation rejects nonsense', throws(() => validateArenaDefinition({ shape: 'hexagon' } as never)) && throws(() => validateArenaDefinition({ shape: 'circle' })) && throws(() => validateArenaDefinition({ shape: 'square' })) && throws(() => validateArenaDefinition({ shape: 'circle', radius: -1 })) && throws(() => validateArenaDefinition({ shape: 'circle', radius: 5, edge: 'lava' as never })) && !throws(() => validateArenaDefinition({ shape: 'rectangle', width: 20, height: 10 })));
}

console.log(failures === 0 ? '\ngeometry check passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
