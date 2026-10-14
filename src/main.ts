// Temporary harness for checking mic capture; Task 8 replaces this file.
import { listMics, requestMicPermission, startMic } from "./audio";

const out = document.querySelector<HTMLPreElement>("#out")!;

document.querySelector("#test")!.addEventListener("click", async () => {
  await requestMicPermission();
  const mics = await listMics();
  const mic = mics.find((m) => /bluetooth|headset|hands-free/i.test(m.label)) ?? mics[0];
  out.textContent = `Mics:\n${mics.map((m) => m.label).join("\n")}\n\nUsing ${mic.label}`;
  let lastShown = 0;
  await startMic(
    mic.deviceId,
    (f) => {
      if (f.t - lastShown < 250) return;
      lastShown = f.t;
      out.textContent = `Using ${mic.label}\n${f.db.toFixed(1)} dB  flatness ${f.flatness.toFixed(2)}  high ${f.highRatio.toFixed(2)}`;
    },
    () => (out.textContent += "\nMic ended"),
  );
});
