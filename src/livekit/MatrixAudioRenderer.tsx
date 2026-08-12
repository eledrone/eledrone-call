/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { getTrackReferenceId } from "@livekit/components-core";
import { type Room as LivekitRoom } from "livekit-client";
import { type RemoteAudioTrack, Track } from "livekit-client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useTracks,
  AudioTrack,
  type AudioTrackProps,
} from "@livekit/components-react";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import {
  useEarpieceAudioConfig,
  useMediaDevices,
} from "../MediaDevicesContext";
import { useReactiveState } from "../useReactiveState";
import { useBehavior } from "../useBehavior";
import { amplificationFor, audioMix$, audioMixKey } from "../state/AudioMix";
import { getUrlParams } from "../UrlParams";
import * as controls from "../controls";

export interface MatrixAudioRendererProps {
  /**
   * The service URL of the LiveKit room.
   */
  url: string;
  livekitRoom: LivekitRoom;
  /**
   * The list of participant identities to render audio for.
   * This list needs to be composed based on the matrixRTC members so that we do not play audio from users
   * that are not expected to be in the rtc session (local user is excluded).
   */
  validIdentities: string[];
  /**
   * If set to `true`, mutes all audio tracks rendered by the component.
   * @remarks
   * If set to `true`, the server will stop sending audio track data to the client.
   */
  muted?: boolean;
}

/**
 * Takes care of handling remote participants’ audio tracks and makes sure that microphones and screen share are audible.
 *
 * It also takes care of the earpiece audio configuration for iOS devices.
 * This is done by using the WebAudio API to create a stereo pan effect that mimics the earpiece audio.
 * @example
 * ```tsx
 * <LiveKitRoom>
 *   <MatrixAudioRenderer />
 * </LiveKitRoom>
 * ```
 * @public
 */
export function LivekitRoomAudioRenderer({
  url,
  livekitRoom,
  validIdentities,
  muted,
}: MatrixAudioRendererProps): ReactNode {
  const logger = rootLogger.getChild("[MatrixAudioRenderer]");
  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
      Track.Source.Unknown,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: true,
      room: livekitRoom,
    },
  )
    // Only keep audio tracks
    .filter((ref) => ref.publication.kind === Track.Kind.Audio)
    // Only keep tracks from participants that are in the validIdentities list
    .filter((ref) => {
      const isValid = validIdentities.includes(ref.participant.identity);
      if (!isValid) {
        // TODO make sure to also skip the warn logging for the local identity
        // Log that there is an invalid identity, that means that someone is publishing audio that is not expected to be in the call.
        logger.warn(
          `Audio track ${ref.participant.identity} from ${url} has no matching matrix call member`,
          `current members: ${validIdentities.join()}`,
          `track will not get rendered`,
        );
        return false;
      }
      return true;
    });

  // This component is also (in addition to the "only play audio for connected members" logic above)
  // responsible for mimicking earpiece audio on iPhones.
  // The Safari audio devices enumeration does not expose an earpiece audio device.
  // We alternatively use the audioContext pan node to only use one of the stereo channels.

  // This component does get additionally complicated because of a Safari bug.
  // (see: https://bugs.webkit.org/show_bug.cgi?id=251532
  // and the related issues: https://bugs.webkit.org/show_bug.cgi?id=237878
  // and https://bugs.webkit.org/show_bug.cgi?id=231105)
  //
  // AudioContext gets stopped if the webview gets moved into the background.
  // Once the phone is in standby audio playback will stop.
  // So we can only use the pan trick only works is the phone is not in standby.
  // If earpiece mode is not used we do not use audioContext to allow standby playback.
  // shouldUseAudioContext is set to false if stereoPan === 0 to allow standby bluetooth playback.

  const { pan: stereoPan, volume: volumeFactor } = useEarpieceAudioConfig();
  const shouldUseAudioContext = stereoPan !== 0;

  // The other reason a track may need the audio context: a media element will
  // not play louder than the volume its audio arrived at, so a participant
  // turned up beyond 100% needs a gain node to make up the difference. That is
  // asked for one track at a time, because of the standby problem above — and
  // only on browsers where it is safe at all, see `canAmplify$`.
  const mix = useBehavior(audioMix$);

  // initialize the potentially used audio context.
  const [audioContext, setAudioContext] = useState<AudioContext | undefined>(
    undefined,
  );
  useEffect(() => {
    const ctx = new AudioContext();
    setAudioContext(ctx);
    return (): void => {
      void ctx.close();
    };
  }, []);

  // Audio played through the context leaves by the context's own output rather
  // than the media element's, so the chosen speaker has to be applied here too.
  // Not every browser can do this; the ones that cannot play such audio on the
  // default device.
  const audioOutputId = useBehavior(
    useMediaDevices().audioOutput.selected$,
  )?.id;
  const { controlledAudioDevices } = getUrlParams();
  // Whether audio can be played above 100% at all depends on where it would end
  // up coming out, so the answer is reconsidered whenever the speaker changes
  useEffect(() => amplificationFor(audioOutputId), [audioOutputId]);
  useEffect(() => {
    if (audioContext && "setSinkId" in audioContext && !controlledAudioDevices)
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId
      // @ts-expect-error - setSinkId doesn't exist yet in types, maybe because it's not supported everywhere.
      audioContext.setSinkId(audioOutputId).catch((ex) => {
        rootLogger.warn("Unable to change sink for audio context", ex);
      });
  }, [audioContext, audioOutputId, controlledAudioDevices]);

  return (
    // We add all audio elements into one <div> for the browser developer tool experience/tidyness.
    <div style={{ display: "none" }}>
      {tracks.map((trackRef) => {
        const boost =
          mix.get(
            audioMixKey(
              trackRef.participant.identity,
              trackRef.publication.source,
            ),
          )?.gain ?? 1;
        return (
          <AudioTrackWithAudioNodes
            key={getTrackReferenceId(trackRef)}
            trackRef={trackRef}
            muted={muted}
            audioContext={
              shouldUseAudioContext || boost > 1 ? audioContext : undefined
            }
            // Silencing the track is normally the media element's job, but the
            // element is bypassed whenever the context is in use, so in that
            // case the gain has to do it
            gain={muted ? 0 : volumeFactor * boost}
            pan={stereoPan}
          />
        );
      })}
    </div>
  );
}

interface StereoPanAudioTrackProps {
  muted?: boolean;
  audioContext?: AudioContext;
  /**
   * The gain to apply to this track, if it is routed through the audio context.
   */
  gain: number;
  /**
   * The stereo pan to apply to this track, if it is routed through the audio
   * context.
   */
  pan: number;
}

/**
 * This wraps `livekit.AudioTrack` to allow adding audio nodes to a track.
 * It main purpose is to remount the AudioTrack component when switching from
 * audioContext to normal audio playback.
 * As of now the AudioTrack component does not support adding audio nodes while being mounted.
 * @param props The component props
 * @param props.trackRef The track reference
 * @param props.muted If the track should be muted
 * @param props.audioContext The audio context to use
 * @param props.gain The gain to apply when using the audio context
 * @param props.pan The stereo pan to apply when using the audio context
 * @returns
 */
function AudioTrackWithAudioNodes({
  trackRef,
  muted,
  audioContext,
  gain,
  pan,
  ...props
}: StereoPanAudioTrackProps &
  AudioTrackProps &
  React.RefAttributes<HTMLAudioElement>): ReactNode {
  // The nodes belong to this one track rather than being shared between all of
  // them, because every track is turned up and down on its own.
  const audioNodes = useMemo(
    () =>
      audioContext && {
        gain: audioContext.createGain(),
        pan: audioContext.createStereoPanner(),
      },
    [audioContext],
  );

  // Simple effects to update the gain and pan node based on the props
  useEffect(() => {
    if (audioNodes) audioNodes.pan.pan.value = pan;
  }, [audioNodes, pan]);
  useEffect(() => {
    if (audioNodes) audioNodes.gain.gain.value = gain;
  }, [audioNodes, gain]);

  // This is used to unmount/remount the AudioTrack component.
  // Mounting needs to happen after the audioContext is set.
  // (adding the audio context when already mounted did not work outside strict mode)
  const [trackReady, setTrackReady] = useReactiveState(
    () => false,
    // The track has to be reset whenever it starts or stops using the context.
    [audioNodes],
  );

  useEffect(() => {
    if (!trackRef || trackReady) return;
    const track = trackRef.publication.track as RemoteAudioTrack;
    // audioNodes exists exactly when the context does
    track.setAudioContext(audioContext);
    track.setWebAudioPlugins(
      audioNodes ? [audioNodes.gain, audioNodes.pan] : [],
    );
    setTrackReady(true);
    controls.setPlaybackStarted();
  }, [audioContext, audioNodes, setTrackReady, trackReady, trackRef]);

  return (
    trackReady && <AudioTrack trackRef={trackRef} muted={muted} {...props} />
  );
}
