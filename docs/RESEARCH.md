# Runtime research notes

Last reviewed: 2026-10-31

## Version target

The current official Kodub release found during research is **PolyTrack 0.6.3**. Kodub's release notes say 0.6.3 is compatible with 0.6.0, 0.6.1 and 0.6.2:

- https://www.kodub.com/updates

The extension must still detect the actual game version at runtime before any version-specific adapter is enabled. A version number in documentation is not proof that the currently open game tab is running that build.

## Known game architecture

The community modding guide describes the browser game as JavaScript with:
- Ammo.js for physics simulation;
- Three.js for rendering;
- Pako for track-code compression;
- a main bundle and a separate simulation worker.

It also notes that the shipped bundles are obfuscated, so internal names and message formats must be verified against the exact build rather than guessed.

Reference: https://github.com/polytrackmods/Modding-Guide

## A proven integration direction

A separate open-source research project, PolyBot, documents a PolyModLoader simulation-worker bridge for PolyTrack 0.6.3. Its bridge uses a worker mixin and a local WebSocket protocol to exchange fixed-step actions and vehicle-state observations. The documented state includes position, orientation, velocity, wheel contacts, checkpoint progress and track lookahead.

References:
- https://github.com/michael201110/poly-bot
- https://github.com/michael201110/poly-bot/blob/main/docs/game-integration.md
- https://github.com/michael201110/poly-bot/blob/main/docs/protocol.md

This is evidence that a reliable state-driven controller is possible, but it is **not** an API exposed by the normal game page. The documented bridge depends on PolyModLoader and exact version-specific worker mixins. This Chrome extension does not currently include that bridge, and its keyboard recorder must not be mistaken for live telemetry.

## Planned implementation stages

1. Detect the active game frame and report its origin, canvas and version evidence.
2. Establish a version-pinned, read-only telemetry bridge.
3. Verify deterministic resets, fixed-step updates and checkpoint progress before using telemetry.
4. Record state/action pairs for local practice.
5. Build a track representation and validate it against repeated runs.
6. Optimize candidate routes offline, then compare predicted and actual lap times.
7. Add closed-loop control only after the telemetry and simulation adapter pass repeatability tests.

## Fair-play boundary

The project is intended for private practice and local experimentation. Do not use automated runs to submit leaderboard results or gain an advantage in multiplayer. Do not make requests to game services or modify leaderboard/profile data.
