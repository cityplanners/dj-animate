"""Convert the editor's exported video into an exact five-second silent GIF."""
import argparse
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('video', type=Path)
parser.add_argument('--out', type=Path, default=Path('dj-animate-sample.gif'))
args = parser.parse_args()
filters = ('[0:v]tpad=stop_mode=clone:stop_duration=5,trim=duration=5,'
           'fps=20,scale=960:540:flags=lanczos,split[a][b];'
           '[a]palettegen=max_colors=192[p];'
           '[b][p]paletteuse=dither=sierra2_4a')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(args.video),
                '-filter_complex', filters, '-frames:v', '100', '-loop', '0', str(args.out)], check=True)
print(f'Saved 100-frame, 20-fps, five-second GIF: {args.out}')
