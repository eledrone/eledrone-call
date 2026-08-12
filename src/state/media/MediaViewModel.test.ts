/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import {
  type LocalTrackPublication,
  LocalVideoTrack,
  Track,
  TrackEvent,
} from "livekit-client";
import { waitFor } from "@testing-library/dom";

import {
  mockLocalParticipant,
  mockMediaDevices,
  mockRtcMembership,
  mockLocalMedia,
  mockRemoteMedia,
  withTestScheduler,
  mockRemoteParticipant,
  mockRemoteScreenShare,
} from "../../utils/test";
import { constant } from "../Behavior";
import { playbackVolumes } from "../../settings/settings";
import { audioMix$, audioMixKey, canAmplify$ } from "../AudioMix";
import { maxVolume } from "../VolumeControls";

global.MediaStreamTrack = class {} as unknown as {
  new (): MediaStreamTrack;
  prototype: MediaStreamTrack;
};
global.MediaStream = class {} as unknown as {
  new (): MediaStream;
  prototype: MediaStream;
};

const platformMock = vi.hoisted(() => vi.fn(() => "desktop"));
vi.mock("../../Platform", () => ({
  get platform(): string {
    return platformMock();
  },
}));

const rtcMembership = mockRtcMembership("@alice:example.org", "AAAA");
const mic = Track.Source.Microphone;

// Volumes are remembered between view models, so each test starts from scratch.
// Assume a browser that can amplify unless the test says otherwise.
beforeEach(() => {
  playbackVolumes.setValue({});
  canAmplify$.next(true);
});

test("control a participant's volume", () => {
  const setVolumeSpy = vi.fn();
  const vm = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({ setVolume: setVolumeSpy }),
  );
  withTestScheduler(({ expectObservable, schedule }) => {
    schedule("-ab---c---d|", {
      a() {
        // Try muting by toggling
        vm.togglePlaybackMuted();
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0, mic);
      },
      b() {
        // Try unmuting by dragging the slider back up
        vm.adjustPlaybackVolume(0.6);
        vm.adjustPlaybackVolume(0.8);
        vm.commitPlaybackVolume();
        expect(setVolumeSpy).toHaveBeenCalledWith(0.6, mic);
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0.8, mic);
      },
      c() {
        // Try muting by dragging the slider back down
        vm.adjustPlaybackVolume(0.2);
        vm.adjustPlaybackVolume(0);
        vm.commitPlaybackVolume();
        expect(setVolumeSpy).toHaveBeenCalledWith(0.2, mic);
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0, mic);
      },
      d() {
        // Try unmuting by toggling
        vm.togglePlaybackMuted();
        // The volume should return to the last non-zero committed volume
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0.8, mic);
      },
    });
    expectObservable(vm.playbackVolume$).toBe("ab(cd)(ef)g", {
      a: 1,
      b: 0,
      c: 0.6,
      d: 0.8,
      e: 0.2,
      f: 0,
      g: 0.8,
    });
  });
});

test("control a participant's screen share volume", () => {
  const setVolumeSpy = vi.fn();
  const vm = mockRemoteScreenShare(
    rtcMembership,
    {},
    mockRemoteParticipant({ setVolume: setVolumeSpy }),
  );
  withTestScheduler(({ expectObservable, schedule }) => {
    schedule("-ab---c---d|", {
      a() {
        // Try muting by toggling
        vm.togglePlaybackMuted();
        expect(setVolumeSpy).toHaveBeenLastCalledWith(
          0,
          Track.Source.ScreenShareAudio,
        );
      },
      b() {
        // Try unmuting by dragging the slider back up
        vm.adjustPlaybackVolume(0.6);
        vm.adjustPlaybackVolume(0.8);
        vm.commitPlaybackVolume();
        expect(setVolumeSpy).toHaveBeenCalledWith(
          0.6,
          Track.Source.ScreenShareAudio,
        );
        expect(setVolumeSpy).toHaveBeenLastCalledWith(
          0.8,
          Track.Source.ScreenShareAudio,
        );
      },
      c() {
        // Try muting by dragging the slider back down
        vm.adjustPlaybackVolume(0.2);
        vm.adjustPlaybackVolume(0);
        vm.commitPlaybackVolume();
        expect(setVolumeSpy).toHaveBeenCalledWith(
          0.2,
          Track.Source.ScreenShareAudio,
        );
        expect(setVolumeSpy).toHaveBeenLastCalledWith(
          0,
          Track.Source.ScreenShareAudio,
        );
      },
      d() {
        // Try unmuting by toggling
        vm.togglePlaybackMuted();
        // The volume should return to the last non-zero committed volume
        expect(setVolumeSpy).toHaveBeenLastCalledWith(
          0.8,
          Track.Source.ScreenShareAudio,
        );
      },
    });
    expectObservable(vm.playbackVolume$).toBe("ab(cd)(ef)g", {
      a: 1,
      b: 0,
      c: 0.6,
      d: 0.8,
      e: 0.2,
      f: 0,
      g: 0.8,
    });
  });
});

test("a participant's volume survives them rejoining", () => {
  const vm1 = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  vm1.adjustPlaybackVolume(0.4);
  vm1.commitPlaybackVolume();

  // The participant leaves and rejoins, which gets them a new view model and a
  // new LiveKit participant, neither of which remembers anything themselves
  const setVolumeSpy = vi.fn();
  const vm2 = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({ setVolume: setVolumeSpy }),
  );
  expect(vm2.playbackVolume$.value).toBe(0.4);
  expect(setVolumeSpy).toHaveBeenLastCalledWith(0.4, mic);

  // And the volume to unmute back to is remembered along with it
  vm2.togglePlaybackMuted();
  const vm3 = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  expect(vm3.playbackMuted$.value).toBe(true);
  vm3.togglePlaybackMuted();
  expect(vm3.playbackVolume$.value).toBe(0.4);
});

test("a participant's screen share volume survives them rejoining", () => {
  const vm1 = mockRemoteScreenShare(
    rtcMembership,
    {},
    mockRemoteParticipant({}),
  );
  vm1.adjustPlaybackVolume(0.4);
  vm1.commitPlaybackVolume();

  const setVolumeSpy = vi.fn();
  const vm2 = mockRemoteScreenShare(
    rtcMembership,
    {},
    mockRemoteParticipant({ setVolume: setVolumeSpy }),
  );
  expect(vm2.playbackVolume$.value).toBe(0.4);
  expect(setVolumeSpy).toHaveBeenLastCalledWith(
    0.4,
    Track.Source.ScreenShareAudio,
  );

  // A participant's screen share volume is theirs alone, and shouldn't affect
  // the volume of their microphone
  expect(
    mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}))
      .playbackVolume$.value,
  ).toBe(1);
});

test("turn a participant up beyond 100%", () => {
  const setVolumeSpy = vi.fn();
  const vm = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({ identity: "alice", setVolume: setVolumeSpy }),
  );
  const key = audioMixKey("alice", mic);

  vm.adjustPlaybackVolume(1.5);
  vm.commitPlaybackVolume();
  // A media element will not play louder than the volume its audio arrived at,
  // so the element is asked for 100% and the audio renderer for the rest
  expect(setVolumeSpy).toHaveBeenLastCalledWith(1, mic);
  expect(audioMix$.value.get(key)?.gain).toBe(1.5);

  // Turning them back down again leaves nothing for the renderer to do
  vm.adjustPlaybackVolume(0.5);
  vm.commitPlaybackVolume();
  expect(setVolumeSpy).toHaveBeenLastCalledWith(0.5, mic);
  expect(audioMix$.value.get(key)?.gain).toBe(1);
});

test("make a member louder by turning the others down, where amplifying is not possible", () => {
  canAmplify$.next(false);
  const aliceVolume = vi.fn();
  const bobVolume = vi.fn();
  const alice = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({ identity: "alice", setVolume: aliceVolume }),
  );
  const bob = mockRemoteMedia(
    mockRtcMembership("@bob:example.org", "BBBB"),
    {},
    mockRemoteParticipant({ identity: "bob", setVolume: bobVolume }),
  );

  alice.adjustPlaybackVolume(2);
  alice.commitPlaybackVolume();

  // Alice is played at 100% and Bob at half of that, so she is twice as loud as
  // him — which is what turning her up to 200% was asking for
  expect(aliceVolume).toHaveBeenLastCalledWith(1, mic);
  expect(bobVolume).toHaveBeenLastCalledWith(0.5, mic);
  // Nothing is left for the audio renderer to amplify
  expect(audioMix$.value.get(audioMixKey("alice", mic))?.gain).toBe(1);
  // And the sliders still show what was asked for, not what was done about it
  expect(alice.playbackVolume$.value).toBe(2);
  expect(bob.playbackVolume$.value).toBe(1);

  // Turning her back down puts him back where he was
  alice.adjustPlaybackVolume(1);
  alice.commitPlaybackVolume();
  expect(aliceVolume).toHaveBeenLastCalledWith(1, mic);
  expect(bobVolume).toHaveBeenLastCalledWith(1, mic);
});

test("a participant's screen share can be turned up beyond 100% too", () => {
  const setVolumeSpy = vi.fn();
  const vm = mockRemoteScreenShare(
    rtcMembership,
    {},
    mockRemoteParticipant({ identity: "alice", setVolume: setVolumeSpy }),
  );

  vm.adjustPlaybackVolume(2);
  vm.commitPlaybackVolume();
  expect(setVolumeSpy).toHaveBeenLastCalledWith(
    1,
    Track.Source.ScreenShareAudio,
  );
  // A screen share's boost is its own, and not the member's microphone's
  expect(
    audioMix$.value.get(audioMixKey("alice", Track.Source.ScreenShareAudio))
      ?.gain,
  ).toBe(2);
  expect(audioMix$.value.has(audioMixKey("alice", mic))).toBe(false);
});

test("a volume cannot be turned up past the maximum", () => {
  const vm = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  vm.adjustPlaybackVolume(1000);
  expect(vm.playbackVolume$.value).toBe(maxVolume);
  vm.adjustPlaybackVolume(-1);
  expect(vm.playbackVolume$.value).toBe(0);
});

test("a volume beyond 100% survives a participant rejoining", () => {
  const vm1 = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  vm1.adjustPlaybackVolume(1.8);
  vm1.commitPlaybackVolume();

  const setVolumeSpy = vi.fn();
  const vm2 = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({ identity: "alice", setVolume: setVolumeSpy }),
  );
  expect(vm2.playbackVolume$.value).toBe(1.8);
  expect(setVolumeSpy).toHaveBeenLastCalledWith(1, mic);
  expect(audioMix$.value.get(audioMixKey("alice", mic))?.gain).toBe(1.8);
});

test("a volume the slider is only dragged through is not remembered", () => {
  const vm1 = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  // No commit: the user is still dragging when the participant drops out
  vm1.adjustPlaybackVolume(0.4);

  const vm2 = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  expect(vm2.playbackVolume$.value).toBe(1);
});

test("local media remembers whether it should always be shown", () => {
  const vm1 = mockLocalMedia(
    rtcMembership,
    {},
    mockLocalParticipant({}),
    mockMediaDevices({}),
  );
  withTestScheduler(({ expectObservable, schedule }) => {
    schedule("-a|", { a: () => vm1.setAlwaysShow(false) });
    expectObservable(vm1.alwaysShow$).toBe("ab", { a: true, b: false });
  });

  // Next local media should start out *not* always shown
  const vm2 = mockLocalMedia(
    rtcMembership,
    {},
    mockLocalParticipant({}),
    mockMediaDevices({}),
  );
  withTestScheduler(({ expectObservable, schedule }) => {
    schedule("-a|", { a: () => vm2.setAlwaysShow(true) });
    expectObservable(vm2.alwaysShow$).toBe("ab", { a: false, b: true });
  });
});

test("switch cameras", async () => {
  // Camera switching is only available on mobile
  platformMock.mockReturnValue("android");
  onTestFinished(() => void platformMock.mockReset());

  // Construct a mock video track which knows how to be restarted
  const track = new LocalVideoTrack({
    getConstraints() {},
    addEventListener() {},
    removeEventListener() {},
  } as unknown as MediaStreamTrack);

  let deviceId = "front camera";
  const restartTrack = vi.fn(async ({ facingMode }) => {
    deviceId = facingMode === "user" ? "front camera" : "back camera";
    track.emit(TrackEvent.Restarted);
    return Promise.resolve();
  });
  track.restartTrack = restartTrack;

  Object.defineProperty(track, "mediaStreamTrack", {
    get() {
      return {
        label: "Video",
        getSettings: (): object => ({
          deviceId,
          facingMode: deviceId === "front camera" ? "user" : "environment",
        }),
      };
    },
  });

  const selectVideoInput = vi.fn();

  const vm = mockLocalMedia(
    rtcMembership,
    {},
    mockLocalParticipant({
      getTrackPublication() {
        return { track } as unknown as LocalTrackPublication;
      },
    }),
    mockMediaDevices({
      videoInput: {
        available$: constant(new Map()),
        selected$: constant(undefined),
        select: selectVideoInput,
      },
    }),
  );

  // Switch to back camera
  vm.switchCamera$.value!();
  expect(restartTrack).toHaveBeenCalledExactlyOnceWith({
    facingMode: "environment",
  });
  await waitFor(() => {
    expect(selectVideoInput).toHaveBeenCalledTimes(1);
    expect(selectVideoInput).toHaveBeenCalledWith("back camera");
  });
  expect(deviceId).toBe("back camera");

  // Switch to front camera
  vm.switchCamera$.value!();
  expect(restartTrack).toHaveBeenCalledTimes(2);
  expect(restartTrack).toHaveBeenLastCalledWith({ facingMode: "user" });
  await waitFor(() => {
    expect(selectVideoInput).toHaveBeenCalledTimes(2);
    expect(selectVideoInput).toHaveBeenLastCalledWith("front camera");
  });
  expect(deviceId).toBe("front camera");
});

test("remote media is in waiting state when participant has not yet connected", () => {
  const vm = mockRemoteMedia(rtcMembership, {}, null); // null participant
  expect(vm.waitingForMedia$.value).toBe(true);
});

test("remote media is not in waiting state when participant is connected", () => {
  const vm = mockRemoteMedia(rtcMembership, {}, mockRemoteParticipant({}));
  expect(vm.waitingForMedia$.value).toBe(false);
});

test("remote media is not in waiting state when participant is connected with no publications", () => {
  const vm = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({
      getTrackPublication: () => undefined,
      getTrackPublications: () => [],
    }),
  );
  expect(vm.waitingForMedia$.value).toBe(false);
});

test("remote media is not in waiting state when user does not intend to publish anywhere", () => {
  const vm = mockRemoteMedia(
    rtcMembership,
    {},
    mockRemoteParticipant({}),
    undefined, // No room (no advertised transport)
  );
  expect(vm.waitingForMedia$.value).toBe(false);
});
