# The local matcher's third-party notices

The admin's computer fetches each file below from its own upstream, by the pinned hash in `pins.json` (or `pins-cpu.json`), when a frame first needs it (`docs/research/M10-local-ai.md`). This project redistributes none of them: only its own code, under this folder. The container image is pulled from Docker Hub by digest and never re-hosted.

| What | Upstream | Licence, as read on 2026-11-07 |
| --- | --- | --- |
| LightGlue's `lightglue.py`, `utils.py` (commit `5a650c4`) | github.com/cvg/LightGlue | Apache-2.0 (`LICENSE`) |
| `aliked_lightglue.pth` | github.com/cvg/LightGlue, release `v0.1_arxiv` | Apache-2.0: LightGlue's README licenses the weights with the code |
| ALIKED's network as `aliked.py` | github.com/Shiaoming/ALIKED, through LightGlue | BSD-3-Clause, Copyright (c) 2022 Zhao Xiaoming (the file's header) |
| `aliked-n16.pth` (commit `683d7c6`) | github.com/Shiaoming/ALIKED | BSD-3-Clause (the repository's `LICENSE`, read at that commit) |
| kornia 0.9.0 | PyPI | Apache-2.0 (the wheel's `METADATA` and `LICENSE`) |
| kornia_rs 0.2.0 | PyPI | Apache-2.0 (the wheel's `METADATA` and `licenses/LICENSE`) |
| OpenCV 5.0.0 (`opencv_python_headless`) | PyPI | Apache-2.0; the wheel bundles other libraries (FFmpeg's under LGPL-2.1 among them) listed in its `LICENSE-3RD-PARTY.txt`, unpacked with it |
| PyTorch 2.15.0, torchvision 0.29.2, CUDA runtime | `pytorch/pytorch` on Docker Hub, by digest | BSD-3-Clause for PyTorch and torchvision; the image's CUDA libraries are under NVIDIA's own terms, **not read here**: the image is never re-hosted, so the admin takes them from Docker Hub |
| PyTorch 2.15.0+cpu, torchvision 0.29.2+cpu (`pins-cpu.json`, a computer with no NVIDIA card) | download.pytorch.org | PyTorch: Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND ISC AND MIT AND Zlib (the wheel's `License-Expression`, read 2026-11-13); it bundles `libgomp` and `libgfortran` (GPL-3.0 with the GCC Runtime Library Exception); torchvision: BSD |
| Pillow 13.0.0, SymPy 1.14.0, mpmath 1.3.0, typing_extensions 4.16.0 (`pins-cpu.json`) | PyPI | MIT-CMU; BSD-3-Clause; BSD-3-Clause; PSF-2.0 (each wheel's `METADATA`, read 2026-11-13) |

LightGlue's `superpoint.py` is headed "Magic Leap, Inc. ... CONFIDENTIAL" and its `__init__.py` imports it. **It is never extracted:** only `aliked.py`, `lightglue.py`, `utils.py` and `LICENSE` leave the tarball, with our own `__init__.py`, and a test holds that (`pipeline/tests/unit/test_ai_files.py`). SuperPoint's weights were never fetched.

Upstream publishes no digests for the weights, so their pins are trust on first use: the hashes of the files gate R1 measured.
