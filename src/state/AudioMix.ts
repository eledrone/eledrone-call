/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  type Observable,
} from "rxjs";
import { type Track } from "livekit-client";

import { type Behavior } from "./Behavior";
import { globalScope, type ObservableScope } from "./ObservableScope";
import { platform } from "../Platform";

/**
 * The volume one participant's audio has been asked to play at.
 */
export interface VolumeRequest {
  /**
   * The audio it applies to, named the way the audio renderer knows it: by the
   * identity of the LiveKit participant and the source of the track.
   */
  key: string;
  /**
   * The volume asked for, as a scalar multiplier which may exceed 1.
   */
  volume: number;
}

/**
 * How to actually play one participant's audio, having taken every other
 * participant into account.
 */
export interface TrackVolume {
  /**
   * The volume to ask the media element for. Never more than 1: an element
   * refuses to play louder than the volume its audio arrived at.
   */
  element: number;
  /**
   * The extra gain the audio renderer must apply on top, by way of Web Audio.
   * 1 means the element can do the whole job on its own.
   */
  gain: number;
}

/**
 * Names one participant's audio of one kind, for looking it up in `audioMix$`.
 */
export function audioMixKey(identity: string, source: Track.Source): string {
  return `${identity}|${source}`;
}

/**
 * Whether audio may be played louder than it arrived. Doing so takes Web Audio,
 * which costs something in two situations:
 *
 *   - Safari stops Web Audio when the device goes into standby, so audio
 *     playing through it falls silent in the user's pocket (see the WebKit bugs
 *     listed in MatrixAudioRenderer). Every browser on iOS is Safari.
 *   - Audio playing through Web Audio leaves by the audio context's own output.
 *     Only Chromium can point that at a chosen speaker, so anywhere else it
 *     would escape to the default device — which is harmless if the default
 *     device is what the user picked anyway.
 *
 * Where the answer is no, a member is made louder than the others by turning
 * the others down instead. See `mixVolumes`.
 */
function detectAmplification(speaker: string | undefined): boolean {
  if (platform === "ios") return false;
  if (
    typeof AudioContext !== "undefined" &&
    "setSinkId" in AudioContext.prototype
  )
    return true;
  return speaker === undefined || speaker === "" || speaker === "default";
}

export const canAmplify$ = new BehaviorSubject<boolean>(
  detectAmplification(undefined),
);

/**
 * Reconsiders whether audio may be played louder than it arrived, now that the
 * user is listening on this speaker. Called by the audio renderer, which is
 * where the answer is put to use; tests may set `canAmplify$` directly instead.
 */
export function amplificationFor(speaker: string | undefined): void {
  canAmplify$.next(detectAmplification(speaker));
}

const requests = new Map<symbol, VolumeRequest>();
const requested$ = new BehaviorSubject<ReadonlyMap<string, number>>(new Map());

function publish(): void {
  const volumes = new Map<string, number>();
  for (const { key, volume } of requests.values())
    volumes.set(key, Math.max(volumes.get(key) ?? 0, volume));
  requested$.next(volumes);
}

/**
 * Works out how to play every participant's audio at the volume asked for.
 */
export function mixVolumes(
  requested: ReadonlyMap<string, number>,
  canAmplify: boolean,
): Map<string, TrackVolume> {
  if (canAmplify)
    return new Map(
      [...requested].map(([key, volume]) => [
        key,
        { element: Math.min(volume, 1), gain: Math.max(volume, 1) },
      ]),
    );

  // Without amplification, the only way to make one member louder than the
  // rest is to make the rest quieter: the loudest of them is played at 100%
  // and everyone else in proportion to them. Turning nobody up past 100%
  // leaves every volume exactly as it was asked for.
  let loudest = 1;
  for (const volume of requested.values()) loudest = Math.max(loudest, volume);
  return new Map(
    [...requested].map(([key, volume]) => [
      key,
      { element: volume / loudest, gain: 1 },
    ]),
  );
}

/**
 * How to play each participant's audio, keyed by `audioMixKey`. Audio which is
 * absent from this map is nobody's business but the media element's.
 */
export const audioMix$: Behavior<ReadonlyMap<string, TrackVolume>> =
  globalScope.behavior(combineLatest([requested$, canAmplify$], mixVolumes));

function sameRequest(
  a: VolumeRequest | null,
  b: VolumeRequest | null,
): boolean {
  return a?.key === b?.key && a?.volume === b?.volume;
}

/**
 * Asks for some audio to be played at a volume, for the duration of the scope,
 * following the given Observable. Emit null to ask for nothing at all.
 *
 * Requests are pooled because how loud one participant should be played depends
 * on how loud the others are: see `mixVolumes`.
 */
export function requestVolume(
  scope: ObservableScope,
  volume$: Observable<VolumeRequest | null>,
): void {
  const requester = Symbol("volume requester");
  const request = (volume: VolumeRequest | null): void => {
    if (volume === null) requests.delete(requester);
    else requests.set(requester, volume);
    publish();
  };

  volume$
    .pipe(distinctUntilChanged(sameRequest), scope.bind())
    .subscribe(request);
  scope.onEnd(() => request(null));
}
