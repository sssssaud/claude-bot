# Paste this into Claude Code (from inside the claude-bot folder)

```
Read CLAUDE.md and PROMPT.md fully, then look at the images in
assets/emotes-original/sheets/ and a few PNGs in assets/emotes-original/.
Open assets/reference/ui-preview.html to see the approved badge/dock/keyboard look.

Work in plan mode first. Do not write any app code yet.

Step 1 — Phase 0 (read-only hardware report):
Run only read-only commands and write the results to docs/HARDWARE.md:
- echo $XDG_SESSION_TYPE ; plasmashell --version
- lsusb | grep -i 187c ; ls -l /dev/hidraw*
- whether OpenRGB is installed (dnf or flatpak) and whether its SDK server is reachable on 127.0.0.1:6742
- python3 -c "import psutil; print(psutil.sensors_temperatures().keys())"
- nvidia-smi --query-gpu=name,driver_version,utilization.gpu,temperature.gpu --format=csv
- the NVIDIA GPU's PCI address and its /sys/bus/pci/devices/<addr>/power/runtime_status
- ls /sys/class/hwmon/*/name and cat them
- node --version ; npm --version ; python3 --version
- claude --version, and check the installed Claude Code hooks docs for the exact
  event names and stdin payload fields
- whether ~/.claude/projects/ contains *.jsonl transcripts (just list, don't print contents)

Do NOT write to the keyboard controller, install packages, or change any system setting.

Step 2 — Show me:
1. The hardware report summary.
2. Which RGB driver tier this machine can use and why.
3. Your plan for Phase 1 (clean_emotes.py + 3D octo in a plain browser page)
   as goal → steps → risks → fallback, with the files you'll create.

Then stop and wait for my OK.
```

## After each phase
Ask Claude Code to: update docs/STATUS.md, commit, tag `phase-N-working`, and push.
