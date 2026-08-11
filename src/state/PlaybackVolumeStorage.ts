/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  defaultVolumeState,
  type VolumeState,
  type VolumeStorage,
} from "./VolumeControls";
import { playbackVolumes } from "../settings/settings";

/**
 * The kinds of audio whose volume is remembered separately: a member's
 * microphone, and the audio of anything they are screen sharing.
 */
type AudioKind = "user-media" | "screen-share";

function isVolume(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/**
 * Reads a volume out of the stored settings, which may contain anything at all
 * given that it is user-writable and outlives any given version of this app.
 */
function parse(stored: unknown): VolumeState | null {
  if (typeof stored !== "object" || stored === null) return null;
  const { volume, committedVolume } = stored as Partial<VolumeState>;
  if (!isVolume(volume)) return null;
  return {
    volume,
    // A committed volume of zero would leave the unmute button with nothing to
    // restore, so fall back to the default
    committedVolume:
      isVolume(committedVolume) && committedVolume > 0
        ? committedVolume
        : defaultVolumeState.committedVolume,
  };
}

function isDefault({ volume, committedVolume }: VolumeState): boolean {
  return (
    volume === defaultVolumeState.volume &&
    committedVolume === defaultVolumeState.committedVolume
  );
}

/**
 * Storage which remembers the volume set for a member's audio for as long as
 * this device's settings last. The volume is remembered per user rather than
 * per session or device, so it applies to them however they rejoin.
 */
export function playbackVolumeStorage(
  kind: AudioKind,
  userId: string,
): VolumeStorage {
  const key = `${kind}/${userId}`;
  return {
    load: () => parse(playbackVolumes.getValue()[key]) ?? defaultVolumeState,
    save: (state) => {
      const { [key]: previous, ...others } = playbackVolumes.getValue();
      // Volumes left at their default are dropped rather than stored, so that
      // the setting only ever grows with the members actually adjusted
      if (isDefault(state)) {
        if (previous !== undefined) playbackVolumes.setValue(others);
      } else {
        playbackVolumes.setValue({ ...others, [key]: state });
      }
    },
  };
}
