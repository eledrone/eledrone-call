/*
Copyright 2026 Element Creations Ltd.

SPDX-License-IdFentifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import {
  isLivekitTransportConfig,
  type LivekitTransportConfig,
} from "matrix-js-sdk/lib/matrixrtc";
import { type MatrixClient } from "matrix-js-sdk";
import { type Logger } from "matrix-js-sdk/lib/logger";

import type { ResolvedConfigOptions } from "../../../config/ConfigOptions.ts";
import { doNetworkOperationWithRetry } from "../../../utils/matrix.ts";

type TransportDiscoveryClient = Pick<
  MatrixClient,
  "getDomain" | "_unstable_getRTCTransports"
>;

export interface RtcTransportAutoDiscoveryProps {
  client: TransportDiscoveryClient;
  resolvedConfig: ResolvedConfigOptions;
  logger: Logger;
}

export class RtcTransportAutoDiscovery {
  private readonly client: TransportDiscoveryClient;
  private readonly resolvedConfig: ResolvedConfigOptions;
  private readonly logger: Logger;

  public constructor({
    client,
    resolvedConfig,
    logger,
  }: RtcTransportAutoDiscoveryProps) {
    this.client = client;
    this.resolvedConfig = resolvedConfig;
    this.logger = logger.getChild("[RtcTransportAutoDiscovery]");
  }

  public async discoverPreferredTransport(): Promise<LivekitTransportConfig | null> {
    // 1) app config URL
    //
    // Upstream asks the backend first and treats config as the last resort.
    // That order is wrong for a deployment that has already been told, in its
    // own config, exactly where the SFU is: asking is at best redundant, and
    // here it is actively harmful.
    //
    // Embedded, the backend query is not an HTTP request - it is an MSC4515
    // widget action answered by the host. eledrone's element-web ships
    // matrix-widget-api 1.17.0, which knows nothing of MSC4515, so it grants
    // the capability and then replies "unknown action". That error carries no
    // httpStatus, so calculateRetryBackoff cannot tell it from a blip and
    // retries it four times with exponential backoff. The join sits there for
    // ~30s waiting on a question whose answer can never change, and the widget
    // stops answering the host meanwhile - the visible symptom was a call that
    // never connected and an io.element.device_mute that timed out.
    //
    // So: if we have been given a URL, use it and do not ask. Discovery is
    // still tried when no URL is configured, which is every other deployment.
    const configTransport = this.tryConfigTransport();
    if (configTransport) {
      this.logger.info(
        `Found app config transport: ${configTransport.livekit_service_url}`,
      );
      return configTransport;
    }

    // 2) backend transports
    const backendTransport = await this.tryBackendTransports();
    if (backendTransport) {
      this.logger.info(
        `Found backend transport: ${backendTransport.livekit_service_url}`,
      );
      return backendTransport;
    }

    return null;
  }

  /**
   * Fetches the first rtc_foci from the backend.
   * This will not throw errors, but instead just log them and return null if the expected config is not found or malformed.
   * @private
   */
  private async tryBackendTransports(): Promise<LivekitTransportConfig | null> {
    const client = this.client;
    // MSC4143: Attempt to fetch transports from backend.
    this.logger.info("First try to use getRTCTransports end point ...");
    try {
      const transportList = await doNetworkOperationWithRetry(async () =>
        client._unstable_getRTCTransports(),
      );
      const first = transportList.find(isLivekitTransportConfig);
      if (first) {
        return first;
      } else {
        this.logger.info(
          `No livekit transport found in getRTCTransports end point`,
          transportList,
        );
      }
    } catch (ex) {
      this.logger.info(`Failed to use getRTCTransports end point: ${ex}`);
    }
    return null;
  }

  private tryConfigTransport(): LivekitTransportConfig | null {
    const url = this.resolvedConfig.livekit?.livekit_service_url;
    if (url) {
      return {
        type: "livekit",
        livekit_service_url: url,
      };
    }
    return null;
  }
}
