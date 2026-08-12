/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { defineConfig, mergeConfig } from "vite";
import generateFile from "vite-plugin-generate-file";

import fullConfig from "./vite.config";

const base = "./";

// Config for embedded deployments (possibly hosted under a non-root path)
export default defineConfig((env) =>
  mergeConfig(
    fullConfig({ ...env, packageType: "embedded" }),
    defineConfig({
      base, // Use relative URLs to allow the app to be hosted under any path
      publicDir: false, // Don't serve the public directory which only contains the favicon
      plugins: [
        generateFile([
          {
            type: "json",
            output: "./config.json",
            data: {
              matrix_rtc_session: {
                wait_for_key_rotation_ms: 5000,
                delayed_leave_event_restart_ms: 4000,
                delayed_leave_event_delay_ms: 18000,
              },
              // Where the SFU is, for a homeserver that will not say.
              //
              // Transport discovery is: the MSC4143 transports endpoint, then
              // this. It used to fall back to .well-known in between, which is
              // how eledrone's calls worked at all - Dendrite answers 404 for
              // that endpoint, and the SFU is advertised in .well-known. Upstream
              // removed that middle step (element-hq/element-call#4153), so
              // without this there is nowhere left to find a transport and no
              // call ever connects.
              //
              // Remove this once the homeserver implements the endpoint, which
              // is where upstream is heading.
              livekit: {
                livekit_service_url: "https://call.gandon.pp.ua/livekit/jwt",
              },
            },
          },
        ]),
      ],
    }),
  ),
);
