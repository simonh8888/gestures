# Matcher test fixtures

Real captured hand-landmark data for testing the matching engine offline
(`node ../matcher.replay.js`). This is how you test against **non-hardcoded**,
real-hand data instead of the synthetic poses in `matcher.test.js`.

## Capturing a fixture

1. Load the extension and open the popup; click **Activate Camera**.
2. Right-click the popup → **Inspect** to open *its* DevTools console.
3. Strike a pose with one hand, then in the console run:
   ```js
   copy(JSON.stringify(window.dumpLandmarks()))
   ```
   (`copy(...)` puts it on your clipboard.)
4. Create a file here, e.g. `point_up_template.json`:
   ```json
   {
     "label": "point_up",
     "role": "template",
     "action": "scroll_up",
     "landmarks": <paste here>
   }
   ```

## Roles

- `"role": "template"` — the reference pose the matcher compares against
  (capture **one** clean one per gesture).
- `"role": "sample"` — a test pose you want matched (capture **several** per
  gesture, varying position, distance, and angle to stress the matcher).

## Running

```bash
node chrome-extension/matcher.replay.js
# tune the threshold:
THRESHOLD=0.4 node chrome-extension/matcher.replay.js
```

The runner prints each sample's distance to every template and whether it
matched its own label — use the distances to pick a good threshold.
