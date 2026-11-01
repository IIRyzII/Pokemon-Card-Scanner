// The phone's back camera, started into a <video> while a scanner is on screen.

import { useEffect, useState, type RefObject } from 'react';

/** Starts the back camera into `video` while mounted, at up to `width`×`height`. Returns why it couldn't, if it couldn't. */
export function useBackCamera(video: RefObject<HTMLVideoElement | null>, width = 1920, height = 1080): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(window.isSecureContext ? 'This browser has no camera access: use a photo instead.' : 'The camera only works on an https:// page.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: width }, height: { ideal: height } },
        });
        if (gone) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        }
      } catch (err) {
        setError(
          (err as DOMException).name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser settings, or use a photo instead.'
            : 'No camera could be started. You can use a photo instead.',
        );
      }
    })();
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [video, width, height]);
  return error;
}
