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

// Volumes are remembered between view models, so each test starts from scratch
beforeEach(() => playbackVolumes.setValue({}));

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
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0);
      },
      b() {
        // Try unmuting by dragging the slider back up
        vm.adjustPlaybackVolume(0.6);
        vm.adjustPlaybackVolume(0.8);
        vm.commitPlaybackVolume();
        expect(setVolumeSpy).toHaveBeenCalledWith(0.6);
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0.8);
      },
      c() {
        // Try muting by dragging the slider back down
        vm.adjustPlaybackVolume(0.2);
        vm.adjustPlaybackVolume(0);
        vm.commitPlaybackVolume();
        expect(setVolumeSpy).toHaveBeenCalledWith(0.2);
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0);
      },
      d() {
        // Try unmuting by toggling
        vm.togglePlaybackMuted();
        // The volume should return to the last non-zero committed volume
        expect(setVolumeSpy).toHaveBeenLastCalledWith(0.8);
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
  expect(setVolumeSpy).toHaveBeenLastCalledWith(0.4);

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
