/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { Track, type RemoteParticipant } from "livekit-client";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
} from "rxjs";

import { constant, type Behavior } from "../Behavior";
import { type ObservableScope } from "../ObservableScope";
import {
  createVolumeControls,
  defaultVolumeState,
  type VolumeControls,
} from "../VolumeControls";
import {
  type AudioKind,
  playbackVolumeStorage,
} from "../PlaybackVolumeStorage";
import { audioMix$, audioMixKey, requestVolume } from "../AudioMix";

const sources: Record<
  AudioKind,
  Track.Source.Microphone | Track.Source.ScreenShareAudio
> = {
  "user-media": Track.Source.Microphone,
  "screen-share": Track.Source.ScreenShareAudio,
};

interface RemoteVolumeInputs {
  participant$: Behavior<RemoteParticipant | null>;
  pretendToBeDisconnected$: Behavior<boolean>;
  /**
   * The kind of audio these controls apply to.
   */
  kind: AudioKind;
  /**
   * The member whose audio this is, under whose name the volume is remembered.
   */
  userId: string;
}

/**
 * Creates volume controls for another member's audio: remembered for the next
 * time they are heard from, and able to go above 100%.
 */
export function createRemoteVolumeControls(
  scope: ObservableScope,
  { participant$, pretendToBeDisconnected$, kind, userId }: RemoteVolumeInputs,
): VolumeControls {
  const source = sources[kind];
  const key$ = scope.behavior(
    participant$.pipe(map((p) => p && audioMixKey(p.identity, source))),
  );

  // The volume asked for, as the controls see it — which includes being
  // silenced while we are pretending to be disconnected
  const asked$ = new BehaviorSubject(defaultVolumeState.volume);
  const controls = createVolumeControls(scope, {
    pretendToBeDisconnected$,
    sink$: constant((volume: number) => asked$.next(volume)),
    storage: playbackVolumeStorage(kind, userId),
  });

  // How loud this member is played depends on how loud the others are: a
  // browser that cannot amplify makes one member louder by turning the rest
  // down instead. So the request is pooled with everyone else's...
  requestVolume(
    scope,
    combineLatest([key$, asked$], (key, volume) =>
      key === null ? null : { key, volume },
    ),
  );

  // ...and this member is played however that works out. Anything the media
  // element cannot do on its own is left to the audio renderer.
  combineLatest([participant$, key$, audioMix$])
    .pipe(
      map(
        ([participant, key, mix]) =>
          [
            participant,
            (key === null ? undefined : mix.get(key))?.element ?? 1,
          ] as const,
      ),
      distinctUntilChanged(
        ([participant, volume], [nextParticipant, nextVolume]) =>
          participant === nextParticipant && volume === nextVolume,
      ),
      scope.bind(),
    )
    .subscribe(([participant, volume]) =>
      participant?.setVolume(volume, source),
    );

  return controls;
}
