"""The hardware governor (docs/research/M26-governor.md): how much of this computer the local worker may use, from moment to moment.

Probe -> Signals -> Policy -> Budget -> Actuators: `probe_linux.py` reads the computer (and the starter's host hints), `policy.py` picks
a profile (`full`, `quiet`, `paused`), `budget.py` turns it into numbers, `actuate.py` applies them, `backends.py` picks where the
matcher runs, and `governor.py` ticks every few seconds and says it all on the worker's `/state`.
"""
