import json, sys, csv, numpy as np, librosa
from ai_edge_litert.interpreter import Interpreter
# Score each logged sound with YAMNet and summarise by label.
S = sys.argv[1]; MODEL = sys.argv[2]; CLASSES = sys.argv[3]
names = [r['display_name'] for r in csv.DictReader(open(CLASSES))]
it = Interpreter(model_path=MODEL); it.allocate_tensors()
inp = it.get_input_details()[0]; outd = it.get_output_details()[0]
N = 15600
SETUP = {"2026-10-17T08-27-52-484Z": [7.6, 11.1], "2026-10-17T08-29-32-980Z": [12.7], "2026-10-21T05-25-24-624Z": [8.1], "2026-10-21T05-34-29-105Z": [8.0, 11.6]}
MISSED = {"2026-10-21T05-18-15-044Z": [46.6], "2026-10-21T05-24-17-629Z": [34.9], "2026-10-21T05-25-24-624Z": [92.3]}
import os
sounds = [x for x in json.load(open(f"{S}/sounds.json")) if os.path.exists(f"{S}/wav/{x['id']}.wav")]
counted = {}
for s in sounds:
    if s['kind'] == 'rep': counted[s['id']] = counted.get(s['id'], 0) + 1
def near(lst, t): return any(abs(t - x) < 0.15 for x in lst)
def label(s):
    if near(SETUP.get(s['id'], []), s['end']): return 'setup'
    if near(MISSED.get(s['id'], []), s['end']): return 'missed'
    if s['kind'] == 'rep' and s['actual'] is not None and counted.get(s['id']) == s['actual']: return 'rep'
    if s['kind'] == 'rep': return 'rep?'
    return 'rejected'
audio = {}
def score(s):
    y = audio.get(s['id'])
    if y is None:
        y = audio[s['id']] = librosa.load(f"{S}/wav/{s['id']}.wav", sr=16000)[0]
    a, b = int(s['start'] * 16000), int(s['end'] * 16000)
    mids = [ (a + b) // 2 ] if b - a <= N else list(range(a + N // 2, b - N // 2 + 1, N // 2))
    out = []
    for m in mids:
        lo = max(0, m - N // 2); w = y[lo:lo + N]
        w = np.pad(w, (0, N - len(w))).astype(np.float32)
        it.set_tensor(inp['index'], w); it.invoke()
        out.append(it.get_tensor(outd['index']).reshape(-1))
    return np.max(out, axis=0)
rows = []
for s in sounds:
    sc = score(s); top = int(np.argmax(sc))
    rows.append({**s, 'label': label(s), 'breath': float(sc[36]), 'resp': float(max(sc[[23, 36, 39, 40]])), 'top': names[top], 'topScore': float(sc[top])})
json.dump(rows, open(f"{S}/yam.json", "w"))
from collections import Counter
for lab in ['rep', 'missed', 'setup', 'rep?', 'rejected']:
    g = [r for r in rows if r['label'] == lab]
    if not g: continue
    b = np.array([r['breath'] for r in g])
    print(f"{lab:9s} n={len(g):4d} breathing median={np.median(b):.2f} p10={np.percentile(b,10):.2f} p90={np.percentile(b,90):.2f}  top classes: {Counter(r['top'] for r in g).most_common(5)}")
print()
for r in rows:
    if r['label'] in ('setup', 'missed'): print(r['label'], r['id'], round(r['end'],1), f"dur={r['dur']:.0f} breathing={r['breath']:.2f} top={r['top']} {r['topScore']:.2f}")
