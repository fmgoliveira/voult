# Maestro flows

Run against a dev-client build on an emulator or device:

```bash
adb reverse tcp:6565 tcp:6565        # lets the app reach the server on your machine
maestro test .maestro/01-onboard-and-unlock.yaml
maestro test .maestro/02-add-login.yaml
maestro test .maestro/03-scan-qr.yaml
```

The flows have **not** been run yet (no Android SDK was available when they were written);
expect to adjust selectors on first use.
