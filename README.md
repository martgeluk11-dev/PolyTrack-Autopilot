# PolyTrack Autopilot

An experimental Manifest V3 Chrome extension for PolyTrack.

## Current status

**Early development — not a finished fastest-line solver yet.**

The first version provides:
- a small in-game control panel;
- a browser-side decoder for PolyTrack save/export trackcodes (including `PolyTrack2` exports);
- a track inspector showing environment, block counts by block ID, checkpoint count, and coordinate bounds;
- local decoded JSON export for further geometry research;
- a local input-analysis report after recording (throttle, brake, steering, input changes, and brake/steering overlap);
- detection of likely game canvases and embedded game frames;
- a diagnostic report that can be copied for debugging;
- recording and replaying timestamped keyboard inputs, so a known lap can be reproduced;
- an eight-part timeline breakdown of the recorded inputs;
- safe start/stop handling that releases every simulated key when playback ends or the tab loses focus.

It does **not** yet map block IDs to exact 3D collision/road meshes, read vehicle telemetry, reproduce the game's physics, or calculate a globally optimal racing line. The current analyzer decodes the track's stored block records and reports their IDs and coordinates; it does not claim that these coordinates alone describe the drivable surface. Input percentages describe keyboard activity, not actual vehicle movement or driving quality. Those require verified access to the current game's track format and physics/runtime state. The extension reports missing capabilities rather than pretending they work.

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this folder.
5. Open PolyTrack in a supported browser tab. If the game is inside an embedded frame, open the game itself in a tab if the panel does not appear.

## Use

- **Track analyzer**: paste a PolyTrack export code (normally starting with `PolyTrack2`) and click **Analyze trackcode**. The extension decodes the map's packed block records locally; it does not require a test lap.
- **Copy decoded track JSON**: copies the decoded block positions, rotations, IDs, and metadata for further analysis.
- **Record**: click, then drive a lap normally using the game's keyboard controls.
- **Stop**: saves the recorded input timeline locally in extension storage.
- **Replay**: replays the saved key timeline from the beginning.
- **Stop bot**: immediately releases all held keys.
- **Diagnostics**: copies frame/canvas information and the current page URL (without cookies or account data).

Replay is timing-based. It is useful for repeatability, but it is not yet adaptive and will drift if the game runs at a different speed or the car collides differently.

See [runtime research and integration notes](docs/RESEARCH.md) for the verified game architecture and the next telemetry milestone.

## Development roadmap

1. Identify the exact current PolyTrack build and supported game frame.
2. Map decoded block IDs and rotations to the game's actual 3D road and collision geometry.
3. Establish a reliable read-only bridge to vehicle state and track/checkpoint progress.
4. Validate a physics model against controlled in-game observations.
5. Build candidate racing lines and optimize braking, steering and throttle.
6. Replace timing replay with closed-loop feedback control.
7. Add automated tests and compare predicted lap times with actual runs.

## Fair-play boundary

Use the recorder/replay tools for private practice only. Do not submit automated or manipulated runs to leaderboards or use the extension in multiplayer competition. PolyTrack's terms prohibit unauthorized software used to gain an unfair leaderboard advantage and automated interaction with its server API.

## Safety and permissions

The extension only runs on the listed game-host domains. It does not request access to browsing history, cookies, passwords, or unrelated sites. It does not send data to a server.

## Contributing

Please include the PolyTrack version, browser version, a diagnostic report, and reproducible steps when reporting a compatibility issue. Do not include private account data.
