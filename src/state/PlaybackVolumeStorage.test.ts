/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { beforeEach, expect, test } from "vitest";

import { playbackVolumeStorage } from "./PlaybackVolumeStorage";
import { defaultVolumeState, type VolumeState } from "./VolumeControls";
import { playbackVolumes } from "../settings/settings";

const alice = "@alice:example.org";
const bob = "@bob:example.org";

beforeEach(() => playbackVolumes.setValue({}));

test("remembers a volume until it is loaded again", () => {
  const storage = playbackVolumeStorage("user-media", alice);
  expect(storage.load()).toEqual(defaultVolumeState);
  storage.save({ volume: 0.5, committedVolume: 0.5 });
  expect(playbackVolumeStorage("user-media", alice).load()).toEqual({
    volume: 0.5,
    committedVolume: 0.5,
  });
});

test("keeps each member and kind of audio apart", () => {
  playbackVolumeStorage("user-media", alice).save({
    volume: 0.5,
    committedVolume: 0.5,
  });
  expect(playbackVolumeStorage("screen-share", alice).load()).toEqual(
    defaultVolumeState,
  );
  expect(playbackVolumeStorage("user-media", bob).load()).toEqual(
    defaultVolumeState,
  );
});

test("stores nothing for volumes left at the default", () => {
  const storage = playbackVolumeStorage("user-media", alice);
  storage.save(defaultVolumeState);
  expect(playbackVolumes.getValue()).toEqual({});
  // A volume returning to the default should be forgotten rather than stored
  storage.save({ volume: 0.5, committedVolume: 0.5 });
  storage.save(defaultVolumeState);
  expect(playbackVolumes.getValue()).toEqual({});
});

test("falls back to the default for values that make no sense", () => {
  // Anything could be in the stored settings: they are user-writable, and
  // outlive any given version of this app
  const nonsense = [
    null,
    "loud",
    {},
    { volume: "loud", committedVolume: 1 },
    { volume: 2, committedVolume: 1 },
    { volume: -1, committedVolume: 1 },
  ];
  for (const stored of nonsense) {
    playbackVolumes.setValue({
      [`user-media/${alice}`]: stored,
    } as unknown as Record<string, VolumeState>);
    expect(playbackVolumeStorage("user-media", alice).load()).toEqual(
      defaultVolumeState,
    );
  }
});

test("keeps a muted volume but not an unusable one to unmute to", () => {
  playbackVolumes.setValue({
    [`user-media/${alice}`]: { volume: 0, committedVolume: 0 },
  });
  // Unmuting has to restore *something*, so the default stands in
  expect(playbackVolumeStorage("user-media", alice).load()).toEqual({
    volume: 0,
    committedVolume: 1,
  });
});
