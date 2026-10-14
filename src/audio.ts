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
 * disconnects) before stop() is called. The caller must still call stop()
 * after onEnded to release the AudioContext.
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
  let stopped = false;
  track.addEventListener("ended", () => {
    if (!stopped) onEnded();
  });

  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode;
  try {
    context = new AudioContext();
    await context.audioWorklet.addModule(workletUrl);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "features", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (event: MessageEvent<Frame>) => onFrame(event.data);
    source.connect(node);
    await context.resume();
  } catch (err) {
    // The caller never gets a session, so release everything here. The error
    // reaches the caller, so onEnded must not fire as well.
    stopped = true;
    source?.disconnect();
    for (const t of stream.getTracks()) t.stop();
    await context?.close().catch(() => {});
    throw err;
  }
  const liveContext = context;
  const liveSource = source;
  const liveNode = node;

  return {
    label: track.label,
    async stop() {
      if (stopped) return;
      stopped = true;
      liveNode.port.onmessage = null;
      liveSource.disconnect();
      for (const t of stream.getTracks()) t.stop();
      await liveContext.close();
    },
  };
}
