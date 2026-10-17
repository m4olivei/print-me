# Task 1 spike results: CUPS + SpliX proof print

Run by the user on the Pi on 2026-10-17. Addresses are replaced with placeholders.

## Outcome

**Success.** SpliX drives the SCX-4623FW over a raw socket. A CUPS test page physically printed.

## What worked

- PPD: `drv:///splix-samsung.drv/scx4623fw.ppd` ("Samsung SCX-4623fw, 2.0.0"). `lpinfo -m` also lists `scx4623f.ppd`; use the `fw` one.
- Device URI scheme: `socket://<printer-ip>:9100`. IPP was not needed.
- Queue name: `scx4623fw`.

```bash
sudo lpadmin -p scx4623fw -E -v socket://<printer-ip>:9100 -m drv:///splix-samsung.drv/scx4623fw.ppd
sudo cupsenable scx4623fw && sudo cupsaccept scx4623fw
lpstat -p scx4623fw     # printer scx4623fw is idle.  enabled since …
lp -d scx4623fw /usr/share/cups/data/testprint
```

To change the address of an existing queue: `sudo lpadmin -p scx4623fw -v socket://<printer-ip>:9100`, then check it with `lpstat -v scx4623fw`.

## Notes for the worker and docs

- **`lp` output format** on this CUPS version: `request id is scx4623fw-3 (1 file(s))`. A trailing ` (1 file(s))` follows the job ID, so the parser must not anchor on end of line. Store `scx4623fw-3` as `cupsJobId`.
- **`lpadmin` warns** `Printer drivers are deprecated and will stop working in a future version of CUPS.` The warning is harmless for now. Document it in troubleshooting as a future CUPS upgrade risk.
- **CUPS reports success even when the printer address is wrong.** The first queue setup used the wrong IP, which pointed at another live host on the LAN. `lp` still returned request IDs, and those jobs never printed. This confirms that `printed` only means "accepted by CUPS". The README should tell users to check the address with `lpstat -v` and to make a DHCP reservation.
- **To clear stuck jobs:** `lpstat -o scx4623fw`, then `cancel -a scx4623fw` (add `sudo` if it says "not authorized").
- **Service-user permissions:** not tested. No `print-me` system user exists yet. This is deferred to the deployment validation step `sudo -u print-me lp -d scx4623fw sample.pdf`.
