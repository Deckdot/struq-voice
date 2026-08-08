/**
 * Grants Windows loopback audio to the meeting window and nothing else.
 *
 * Chromium requires a video track in a getDisplayMedia request even when only
 * audio is wanted, so a screen source is supplied and the renderer stops the
 * video track the instant the stream resolves. Nothing is ever encoded from
 * it.
 */

import { desktopCapturer, session } from "electron";

export const installLoopbackHandler = (): void => {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const url = request.frame?.url ?? "";
      if (!url.includes("meeting/index.html")) {
        // Only the meeting window may capture the desktop. Anything else is
        // refused rather than silently granted.
        callback({});
        return;
      }
      void desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const screenSource = sources[0];
          if (screenSource === undefined) {
            callback({});
            return;
          }
          callback({ video: screenSource, audio: "loopback" });
        })
        .catch(() => {
          callback({});
        });
    }
  );
};
