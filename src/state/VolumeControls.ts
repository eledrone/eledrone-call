/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  combineLatest,
  filter,
  map,
  merge,
  of,
  Subject,
  switchMap,
} from "rxjs";

import { type Behavior } from "./Behavior";
import { type ObservableScope } from "./ObservableScope";
import { accumulate } from "../utils/observable";

/**
 * The volume that a set of volume controls has been set to. This is the part of
 * their state that outlives them, if they are given somewhere to remember it.
 */
export interface VolumeState {
  /**
   * The volume to which the audio is set, as a scalar multiplier. Zero means
   * muted.
   */
  volume: number;
  /**
   * The volume to return to when unmuting.
   */
  committedVolume: number;
}

export const defaultVolumeState: VolumeState = {
  volume: 1,
  committedVolume: 1,
};

/**
 * The loudest that audio can be turned up to: double the volume it was sent at.
 * Note that an HTML media element cannot play above its natural volume, so
 * anything greater than 1 has to be produced by Web Audio — see `AudioBoost`.
 */
export const maxVolume = 2;

function clampVolume(volume: number): number {
  return Math.min(Math.max(volume, 0), maxVolume);
}

/**
 * A place to remember a volume, so that it survives the volume controls being
 * destroyed and created again.
 */
export interface VolumeStorage {
  load: () => VolumeState;
  save: (state: VolumeState) => void;
}

interface VolumeControlsState extends VolumeState {
  /**
   * Whether this is a volume the user has settled on, as opposed to one they
   * are still dragging the slider through. Only settled volumes are worth
   * remembering.
   */
  settled: boolean;
}

/**
 * Controls for audio playback volume.
 */
export interface VolumeControls {
  /**
   * The volume to which the audio is set, as a scalar multiplier.
   */
  playbackVolume$: Behavior<number>;
  /**
   * Whether playback of this audio is disabled.
   */
  playbackMuted$: Behavior<boolean>;
  togglePlaybackMuted: () => void;
  adjustPlaybackVolume: (value: number) => void;
  commitPlaybackVolume: () => void;
}

interface VolumeControlsInputs {
  pretendToBeDisconnected$: Behavior<boolean>;
  /**
   * The callback to run to notify the module performing audio playback of the
   * requested volume.
   */
  sink$: Behavior<(volume: number) => void>;
  /**
   * Where to remember the requested volume, so that it is restored the next
   * time controls are created for the same audio (as happens when a peer
   * rejoins the call). If omitted, the volume starts at its default and is
   * forgotten along with the controls.
   */
  storage?: VolumeStorage;
}

/**
 * Creates a set of controls for audio playback volume and syncs this with the
 * audio playback module for the duration of the scope.
 */
export function createVolumeControls(
  scope: ObservableScope,
  { pretendToBeDisconnected$, sink$, storage }: VolumeControlsInputs,
): VolumeControls {
  const toggleMuted$ = new Subject<"toggle mute">();
  const adjustVolume$ = new Subject<number>();
  const commitVolume$ = new Subject<"commit">();

  const state$ = scope.behavior<VolumeControlsState>(
    merge(toggleMuted$, adjustVolume$, commitVolume$).pipe(
      accumulate<VolumeControlsState, number | "toggle mute" | "commit">(
        { ...(storage?.load() ?? defaultVolumeState), settled: false },
        (state, event) => {
          switch (event) {
            case "toggle mute":
              return {
                ...state,
                volume: state.volume === 0 ? state.committedVolume : 0,
                settled: true,
              };
            case "commit":
              // Dragging the slider to zero should have the same effect as
              // muting: keep the original committed volume, as if it were never
              // dragged
              return {
                ...state,
                committedVolume:
                  state.volume === 0 ? state.committedVolume : state.volume,
                settled: true,
              };
            default:
              // Volume adjustment
              return { ...state, volume: clampVolume(event), settled: false };
          }
        },
      ),
    ),
  );

  const playbackVolume$ = scope.behavior<number>(
    state$.pipe(map(({ volume }) => volume)),
  );

  // Remember the volume for the next controls created for this audio. Volumes
  // that the slider is merely being dragged through are skipped, so that a
  // single drag results in a single write.
  if (storage !== undefined)
    state$
      .pipe(
        filter(({ settled }) => settled),
        scope.bind(),
      )
      .subscribe(({ volume, committedVolume }) =>
        storage.save({ volume, committedVolume }),
      );

  // Sync the requested volume with the audio playback module
  combineLatest([
    sink$,
    // The playback volume, taking into account whether we're supposed to
    // pretend that the audio stream is disconnected (since we don't necessarily
    // want that to modify the UI state).
    pretendToBeDisconnected$.pipe(
      switchMap((disconnected) => (disconnected ? of(0) : playbackVolume$)),
    ),
  ])
    .pipe(scope.bind())
    .subscribe(([sink, volume]) => sink(volume));

  return {
    playbackVolume$,
    playbackMuted$: scope.behavior<boolean>(
      playbackVolume$.pipe(map((volume) => volume === 0)),
    ),
    togglePlaybackMuted: () => toggleMuted$.next("toggle mute"),
    adjustPlaybackVolume: (value: number) => adjustVolume$.next(value),
    commitPlaybackVolume: () => commitVolume$.next("commit"),
  };
}
