"""Prepare initial dependencies without optional accelerators/wetext.
The GPU comparison subsequently installs matching CUDA torch/torchaudio wheels."""
from pathlib import Path
source=Path('cosy-source/requirements.txt').read_text().splitlines()
exclude=('wetext','deepspeed','tensorrt','onnxruntime','--extra-index-url','torch==','torchaudio==')
lines=[line for line in source if not line.startswith(exclude)]
lines+=['onnxruntime==1.18.0','torch==2.3.1+cpu','torchaudio==2.3.1+cpu']
Path('cosy-cpu-requirements.txt').write_text('\n'.join(lines)+'\n')
