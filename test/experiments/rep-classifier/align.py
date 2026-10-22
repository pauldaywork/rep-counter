import json, sys, numpy as np, librosa
# Cross-correlate the logged frame levels with the audio's own level to find the offset.
log, wav = sys.argv[1], sys.argv[2]
d = json.load(open(log)); fr = (d.get('quietFrames') or []) + d['frames']
t = np.array([f['t'] for f in fr]) / 1000; db = np.array([f['db'] for f in fr])
y, sr = librosa.load(wav, sr=16000)
hop = 0.01; rms = librosa.feature.rms(y=y, frame_length=512, hop_length=160)[0]; adb = 20*np.log10(rms + 1e-9)
grid = np.arange(0, t[-1], hop); ldb = np.interp(grid, t, db)
best = max(range(-200, 201), key=lambda k: np.corrcoef(ldb[max(0,-k):len(ldb)-max(0,k)], adb[max(0,k):max(0,k)+len(ldb)-abs(k)][:len(ldb)-abs(k)])[0,1] if len(adb) > len(ldb) else 0)
print(log.split('/')[-1], 'audio', round(len(y)/sr,1), 's  log', round(t[-1],1), 's  offset', best*hop, 's')
