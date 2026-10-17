---
id: 1
group: "printer-integration"
dependencies: []
status: "completed"
created: 2026-10-17
skills:
  - cups-administration
complexity_score: 3
complexity_notes: "Needs the user's Raspberry Pi and physical printer; the agent cannot run it from the dev VM, so it is guided with the user."
execution_profile: "docs-and-config"
---
# CUPS + SpliX Proof Print on the Pi

## Objective
Prove that the existing CUPS + SpliX install on the Raspberry Pi can physically print a PDF on the Samsung SCX-4623FW through a named CUPS queue, and record the device URI scheme that works. This spike gates the worker and printer documentation.

## Skills Required
cups-administration (`lpadmin`, PPD selection, `lp`, `lpstat`).

## Acceptance Criteria
- [x] A CUPS queue (e.g. `scx4623fw`) exists on the Pi, created with `lpadmin` using `drv:///splix-samsung.drv/scx4623fw.ppd` and a network device URI.
- [x] `lpstat -p <queue>` shows the queue enabled and accepting.
- [x] `lp -d <queue> sample.pdf` returns `request id is <queue>-<n>` and a page physically prints (confirmed by the user).
- [x] The working URI scheme (`socket://<printer-ip>:9100`, `ipp://…`, or other), the exact `lpadmin` command shape (placeholders only), and any CUPS permission note for a loginless service user are recorded in `spike-results.md` in this plan's directory, with **no real IP addresses or hostnames**.
- [x] (Not triggered: SpliX printed.) If SpliX cannot drive the printer, the task is marked `needs-clarification`, execution halts and the alternatives (Samsung driver on another host, PCL/PostScript check) are brought back to the user.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Pi: arm64 Debian 13; `cups`, `cups-client`, `cups-filters`, `printer-driver-splix` already installed with `--no-install-recommends`; CUPS loopback-only.
- PPD: `drv:///splix-samsung.drv/scx4623fw.ppd`.

## Input Dependencies
None.

## Output Artifacts
- `spike-results.md` (placeholders only), used by the worker task (6) and docs task (8).

## Implementation Notes
<details>
<summary>Steps</summary>

This development environment is a cloud VM, **not** the Pi; it has no CUPS and no LAN access to the printer. Ask the user to run the following on the Pi (or ask whether SSH access is available) and paste back the output, redacting the IP:

```bash
lpinfo -m | grep -i 4623          # confirm the PPD is listed
sudo lpadmin -p scx4623fw -E -v socket://<printer-ip>:9100 -m drv:///splix-samsung.drv/scx4623fw.ppd
sudo cupsenable scx4623fw && sudo cupsaccept scx4623fw
lpstat -p scx4623fw
lp -d scx4623fw /usr/share/cups/data/testprint   # or any small PDF
```

If `socket://` does not print, try `ipp://<printer-ip>/ipp/print` or `lpd://<printer-ip>/queue`. Also ask the user to try `sudo -u <service-user> lp -d scx4623fw sample.pdf` if a test system user exists, to learn about CUPS permission requirements (otherwise note this is deferred to deployment validation).

Write the outcome to `spike-results.md` using placeholders like `<printer-ip>`.
</details>
