# Browser checks (Playwright, desktop 1400 px + iPhone 390 px)
`node e2e/<script>.mjs [URL|-]` – without URL a local `dist` is served. Exit code ≠ 0 on failure.
| Script | What |
|---|---|
| acceptance-p1.mjs | Phase 1 acceptance: every feature type by Click & grow vs. demo nominals (tolerances in research/feature-creation-spec.md), raw fit, feedback rows |
| model-lock.mjs | behaviour lock: snapshot of 12 features / 19 controls / CS vs. baseline, save/load roundtrip, 0.27 project file migration (`--baseline` re-records) |
| islands-check.mjs | 0.31: smoothed boundary (preview + created), plane islands on the islands demo (auto, tap → Not an island, Refine), Advanced smoothing |
| live-testpage.mjs | live test page with the real version.json: unlocked Phase-1 items |
| selection-check.mjs | selection choice, seed-area feedback, circle by tap at the rim, Add region, Advanced section |
| datums-check.mjs | datums A\|B\|C, Position/Perpendicularity, Analyze zone, Ø toggle, datum rename/remove (`[URL] [desk\|iphone]`) |
| zone-datum-check, prefs-check, ribbon-check, overlay-check, testpage-check | 0.25–0.28 regressions |
Retired 19.10. (0.30): props-check.mjs (old Properties dialog/training titles; datum rename part moved to datums-check, refit parameters covered by model-lock/acceptance).
