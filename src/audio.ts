import type { Frame } from "./features";
import workletUrl from "./features-worklet.ts?worker&url";

export interface MicSession {
  readonly label: string;
  stop(): Promise<void>;
}

/** Asks for mic access once, so device labels become visible. */
export async function requestMicPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** Real microphones, without Chrome's "default" and "communications" aliases. */
export async function listMics(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (d) => d.kind === "audioinput" && d.label !== "" && d.deviceId !== "default" && d.deviceId !== "communications",
  );
}

/**
 * Opens a mic with the browser's voice processing off and streams feature
 * frames to onFrame. onEnded fires if the mic goes away (e.g. the headset
 * disconnects) before stop() is called.
 */
export async function startMic(
  deviceId: string,
  onFrame: (frame: Frame) => void,
  onEnded: () => void,
): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const [track] = stream.getAudioTracks();
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    await context.close();
    throw err;
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "features", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
  });
  node.port.onmessage = (event: MessageEvent<Frame>) => onFrame(event.data);
  source.connect(node);
  await context.resume();

  let stopped = false;
  track.addEventListener("ended", () => {
    if (!stopped) onEnded();
  });

  return {
    label: track.label,
    async stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      source.disconnect();
      for (const t of stream.getTracks()) t.stop();
      await context.close();
    },
  };
}
