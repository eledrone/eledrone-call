/*
Copyright 2026 Element Software Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, expect, test, vi } from "vitest";

import { amplificationFor, canAmplify$, mixVolumes } from "./AudioMix";

const platformMock = vi.hoisted(() => vi.fn(() => "desktop"));
vi.mock("../Platform", () => ({
  get platform(): string {
    return platformMock();
  },
}));

/** A browser whose Web Audio output can be pointed at a chosen speaker. */
class RoutableAudioContext {
  public setSinkId(): void {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  platformMock.mockReturnValue("desktop");
});

const asked = new Map([
  ["alice", 2],
  ["bob", 1],
  ["carol", 0],
]);

test("plays everyone at the volume asked for, where amplifying is possible", () => {
  // The element does what it can and the audio renderer makes up the rest
  expect(mixVolumes(asked, true)).toEqual(
    new Map([
      ["alice", { element: 1, gain: 2 }],
      ["bob", { element: 1, gain: 1 }],
      ["carol", { element: 0, gain: 1 }],
    ]),
  );
});

test("turns the others down instead, where amplifying is not possible", () => {
  // Everyone keeps the same volume relative to everyone else, and nothing is
  // left for the audio renderer to do
  expect(mixVolumes(asked, false)).toEqual(
    new Map([
      ["alice", { element: 1, gain: 1 }],
      ["bob", { element: 0.5, gain: 1 }],
      ["carol", { element: 0, gain: 1 }],
    ]),
  );
});

test("only amplifies where doing so costs the listener nothing", () => {
  // Chromium: Web Audio can be sent to whichever speaker was chosen
  vi.stubGlobal("AudioContext", RoutableAudioContext);
  amplificationFor("some-headphones");
  expect(canAmplify$.value).toBe(true);

  // Elsewhere, Web Audio escapes to the default device — fine if that is what
  // the listener chose anyway, but not if they picked something else
  vi.stubGlobal("AudioContext", class {});
  amplificationFor("");
  expect(canAmplify$.value).toBe(true);
  amplificationFor(undefined);
  expect(canAmplify$.value).toBe(true);
  amplificationFor("some-headphones");
  expect(canAmplify$.value).toBe(false);

  // On iOS the audio would stop playing in the user's pocket, whatever the
  // speaker, so it is never worth it
  platformMock.mockReturnValue("ios");
  vi.stubGlobal("AudioContext", RoutableAudioContext);
  amplificationFor("");
  expect(canAmplify$.value).toBe(false);
});

test("leaves volumes alone until somebody is turned up past 100%", () => {
  const quiet = new Map([
    ["alice", 1],
    ["bob", 0.4],
  ]);
  const untouched = new Map([
    ["alice", { element: 1, gain: 1 }],
    ["bob", { element: 0.4, gain: 1 }],
  ]);
  // Whichever way the browser goes about it, someone who has never touched a
  // slider hears exactly what they always did
  expect(mixVolumes(quiet, true)).toEqual(untouched);
  expect(mixVolumes(quiet, false)).toEqual(untouched);
});
