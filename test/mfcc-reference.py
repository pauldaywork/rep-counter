"""Reference MFCCs for test/features.test.ts, computed with librosa.

Builds each test signal's power spectrum the way FeatureExtractor does
(symmetric Hann window, unnormalised FFT, |X|^2), then lets librosa apply
the 40-band Slaney mel filter bank over 100 Hz-4 kHz, the dB conversion
and the orthonormal DCT-II, keeping coefficients 1-19.

Run: python3 test/mfcc-reference.py
Values in the test came from librosa 0.11.0 and numpy 2.4.4.
"""

import json

import librosa
import numpy as np

SR, N = 48000, 1024


def mulberry32(seed):
    """test/signals.ts's mulberry32, in 32-bit arithmetic."""
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def next_value():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return next_value


def white_noise(seed, length):
    random = mulberry32(seed)
    return np.array([random() * 2 - 1 for _ in range(length)])


def sine(freq_hz, length, amplitude=0.5):
    return amplitude * np.sin(2 * np.pi * freq_hz * np.arange(length) / SR)


def mfcc(samples):
    window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / (N - 1))
    power = np.abs(np.fft.rfft(samples * window)) ** 2
    mel = librosa.filters.mel(sr=SR, n_fft=N, n_mels=40, fmin=100, fmax=4000)
    db = librosa.power_to_db(mel @ power, ref=1.0, amin=1e-10, top_db=None)
    coefficients = librosa.feature.mfcc(S=db[:, None], n_mfcc=20, dct_type=2, norm="ortho")
    return [round(float(c), 4) for c in coefficients[1:, 0]]


print("whiteNoise(1, 1024):", json.dumps(mfcc(white_noise(1, N))))
tones = sine(300, N, 0.3) + sine(1500, N, 0.2) + sine(3200, N, 0.1)
print("300 + 1500 + 3200 Hz:", json.dumps(mfcc(tones)))
