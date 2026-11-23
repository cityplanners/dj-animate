"""Render the four measured Backseat curves as a standalone graph."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from analyze import BANDS

root = Path(__file__).resolve().parents[1]
data = json.loads((root / 'web/assets/backseat-analysis.json').read_text())
t = np.arange(len(data['curves'][0])) / data['rate'] + data['source_start']
bg = '#17121e'; text = '#fff1f4'; muted = '#b0a1bc'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 12, 'axes.edgecolor': '#59405b', 'text.color': text, 'axes.labelcolor': muted, 'xtick.color': muted, 'ytick.color': muted, 'svg.fonttype': 'none'})
fig, ax = plt.subplots(figsize=(15, 6.6), dpi=150)
fig.patch.set_facecolor(bg); ax.set_facecolor(bg)
for curve, band in zip(data['curves'], BANDS):
    name, lo, hi, attack, release, color = band
    label = f'{name}  ·  {lo:,}–{hi:,} Hz'
    ax.plot(t, curve, color=color, lw=2.0, label=label)
ax.set_ylim(-.03, 1.04); ax.set_xlim(40, 45)
ax.set_yticks(np.arange(0, 1.01, .25)); ax.set_xticks(np.arange(40, 45.01, .5))
ax.set_xticklabels([f'00:{x:04.1f}' for x in np.arange(40, 45.01, .5)])
ax.grid(axis='y', alpha=.28, color='#6e536e'); ax.set_axisbelow(True)
ax.spines[['top', 'right']].set_visible(False)
ax.set_ylabel('Normalized band energy', labelpad=13); ax.set_xlabel('Position in the original track', labelpad=12)
fig.text(.082, .94, 'dj—animate  /  AUDIO LAB', color='#ff79b3', fontsize=11, weight='bold')
fig.text(.082, .876, 'Backseat · four curves, one scene.', color=text, fontsize=24, weight='bold')
fig.text(.082, .825, 'DÊTRE  /  00:40–00:45  /  60 Hz analysis · eased attack and release', color=muted, fontsize=11)
legend = ax.legend(loc='upper center', bbox_to_anchor=(.5, -.26), ncol=4, frameon=False, labelcolor='linecolor', fontsize=10, handlelength=1.9, columnspacing=2.1)
fig.text(.082, .026, 'Measured frequency-band envelopes, not isolated stems. Each band is normalized independently.', color=muted, fontsize=10)
fig.subplots_adjust(left=.082, right=.97, top=.76, bottom=.25)
fig.savefig(root / 'web/assets/backseat-four-bands.png', facecolor=bg)
fig.savefig(root / 'web/assets/backseat-four-bands.svg', facecolor=bg)
np.savetxt(root / 'web/assets/backseat-four-bands.csv', np.column_stack([t, *data['curves']]), delimiter=',', header='source_seconds,bass_30_160,low_mids_160_650,upper_mids_650_4000,highs_4000_10000', comments='')
print('Saved graph PNG, SVG, and measured CSV data.')
