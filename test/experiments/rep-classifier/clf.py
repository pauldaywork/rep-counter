import json, sys, csv, numpy as np, librosa
from ai_edge_litert.interpreter import Interpreter
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
# Leave-one-set-out: train rep vs rejected on the other sets, score the held-out set's sounds.
S, MODEL = sys.argv[1], sys.argv[2]
rows = json.load(open(f"{S}/yam.json"))
it = Interpreter(model_path=MODEL); it.allocate_tensors()
inp = it.get_input_details()[0]; outd = it.get_output_details()[0]
N = 15600; audio = {}
def clip(r):
    y = audio.get(r['id'])
    if y is None: y = audio[r['id']] = librosa.load(f"{S}/wav/{r['id']}.wav", sr=16000)[0]
    return y[int(r['start']*16000):int(r['end']*16000)]
def yam(c):
    out = []
    for lo in range(0, max(1, len(c) - N + 1), N // 2):
        w = np.pad(c[lo:lo+N], (0, max(0, N - len(c[lo:lo+N])))).astype(np.float32)
        it.set_tensor(inp['index'], w); it.invoke(); out.append(it.get_tensor(outd['index']).reshape(-1))
    return np.max(out, axis=0)
def mfcc(c):
    c = np.pad(c, (0, max(0, 2048 - len(c))))
    m = librosa.feature.mfcc(y=c, sr=16000, n_mfcc=20, n_fft=512, hop_length=160, fmin=100, fmax=4000)
    m = m[1:]  # drop c0, the level
    d = librosa.feature.delta(m, width=3) if m.shape[1] >= 3 else np.zeros_like(m)
    sc = librosa.feature.spectral_centroid(y=c, sr=16000, n_fft=512, hop_length=160)
    return np.concatenate([m.mean(1), m.std(1), np.abs(d).mean(1), [sc.mean(), sc.std()]])
use = [r for r in rows if r['label'] in ('rep', 'rejected', 'setup', 'missed')]
F = {'yamnet': np.array([yam(clip(r)) for r in use]), 'mfcc': np.array([mfcc(clip(r)) for r in use])}
F['both'] = np.hstack([F['yamnet'], F['mfcc']])
lab = np.array([r['label'] for r in use]); ids = np.array([r['id'] for r in use])
for name, X in F.items():
    p = np.zeros(len(use))
    for sid in set(ids):
        tr = (ids != sid) & np.isin(lab, ['rep', 'rejected']); te = ids == sid
        if not te.any(): continue
        m = make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=3000, class_weight='balanced'))
        m.fit(X[tr], lab[tr] == 'rep'); p[te] = m.predict_proba(X[te])[:, 1]
    rp, st, ms, rj = p[lab=='rep'], p[lab=='setup'], p[lab=='missed'], p[lab=='rejected']
    print(f"== {name}: setups {np.round(np.sort(st),2)}  missed reps {np.round(ms,2)}")
    print(f"   reps scoring above the highest setup ({st.max():.2f}): {np.mean(rp>st.max()):.0%}; above 0.5: {np.mean(rp>0.5):.0%}; rejected above 0.5: {np.mean(rj>0.5):.0%}; rep percentile of each setup: {[int(np.mean(rp<x)*100) for x in np.sort(st)]}")
print("\n== robustness, mfcc only")
X = F['mfcc']; day = np.array([i[:10] for i in ids])
for group_name, groups in [('set', ids), ('day', day)]:
    for C in [0.01, 0.1, 1.0]:
        p = np.zeros(len(use))
        for g in set(groups):
            tr = (groups != g) & np.isin(lab, ['rep', 'rejected']); te = groups == g
            m = make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=5000, class_weight='balanced'))
            m.fit(X[tr], lab[tr] == 'rep'); p[te] = m.predict_proba(X[te])[:, 1]
        rp, st, ms, rj = p[lab=='rep'], p[lab=='setup'], p[lab=='missed'], p[lab=='rejected']
        print(f"hold out {group_name:3s} C={C:<5} setups max {st.max():.2f}  reps above it {np.mean(rp>st.max()):4.0%}  reps >0.5 {np.mean(rp>0.5):4.0%}  missed {np.round(ms,2)}  rejected >0.5 {np.mean(rj>0.5):3.0%}  passing-check rejects? n/a")
# which rejected sounds score as reps, by reason, held out by set at C=0.1
p = np.zeros(len(use))
for g in set(ids):
    tr = (ids != g) & np.isin(lab, ['rep', 'rejected']); te = ids == g
    m = make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=5000, class_weight='balanced')); m.fit(X[tr], lab[tr]=='rep'); p[te] = m.predict_proba(X[te])[:, 1]
from collections import Counter
hi = Counter(use[i]['reason'].split(' (')[0] for i in range(len(use)) if lab[i]=='rejected' and p[i] > 0.5)
allr = Counter(use[i]['reason'].split(' (')[0] for i in range(len(use)) if lab[i]=='rejected')
print("rejected sounds scoring >0.5, by reason:", {k: f"{hi[k]}/{allr[k]}" for k in allr})
print("days:", Counter(day[lab=='rep']), "setups by day:", Counter(day[lab=='setup']))
