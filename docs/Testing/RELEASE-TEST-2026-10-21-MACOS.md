# macOS follow-up, 21 October 2026

English | [Deutsch](RELEASE-TEST-2026-10-21-MACOS.de.md)

## Result and release status

No product defect confirmed in tested macOS workflows. Windows/Copilot fixes pass macOS follow-up. **Before
release, CI with the local Node 24 fix must pass on the actual release commit.** Previous Windows CI is failing.
No commits, pushes or publication in this round.

## Baseline and environment

Application state `7f4485d80ec1df5b2052637703a75953a0f4b712`. macOS 15.7.5 (24G624), Intel, VS Code 1.142.0,
Node.js 24.22.0, German QWERTZ keyboard. Integration uses isolated profiles/copies of samples; native testing
uses installed production VSIX with separate profile/extensions directory. Original reports and normal VS Code
profile were not used for test edits.

## Automated checks

- Typecheck passed; 162/162 unit tests passed.
- Full integration: **58/58 English and 58/58 German, no retries**. Includes cross-report clipboard with
  images/code/references, image validation, expression search, block conflicts, combined breaks, PDF/Office,
  keyboard operation and three new Copilot regressions.
- German run uses BC_RB_LOCALE=de/BC_RB_TEST_LANGUAGE=de; German language pack installed in isolated extensions.
  Bundle test explicitly forces German extension/webview messages; native sample used English UI.
- Actual Restricted Mode: **1/1 English and 1/1 German**, launcher Exit 0. AL/server blocked, design/preview usable.
- Microsoft BCApps corpus: **379/379** character-identical unchanged and fully regenerated, no problems.
  45,201 editable and 73 preserved items. 368 layouts linked to AL reports, 357 exact datasets; eleven already
  outdated Microsoft layouts still reported by the linter.
- Production VSIX built/checked: 15 extension files, 93 commands, 14 tools, one custom editor; packaged activation
  passed. Separate native-profile install succeeded.

## Native samples

- Revenue design/preview: eight rows, quantity 116, total 37.523,40 €, German numbers/dates and special characters correct.
- Inline text `macOS Prüfung: Grüße & €`: Cmd+V, Cmd+Enter, Cmd+S; XML correctly contains ampersand escaping `&amp;`.
- Cmd+Z restores original bytes; Cmd+Shift+Z restores edited bytes. Another undo leaves the copy identical to original.
- Native PDF Save under `Prüfung & Berichte`; opened in macOS Preview. One page, title, eight lines, total,
  umlauts, euro and design visually correct. Automated tests additionally cover A4, multiple pages and font embedding.
- Normal Cmd+Q of installed package exits with code 0.

### Resolved test-control anomalies

First English run used a non-visible test window: preview/inline confirmation timed out (56/58), label test
needed a retry. With window visibly foregrounded, three targeted cases pass 3/3, then all 58 per language
without retries. Animation frames and focus/blur checks need a genuinely visible, focused window.

After full runs the extension host exited 0, but the windowless VS Code main process remained. First two main
processes were explicitly terminated after tests completed; independent full-launcher exit is not claimed for
them. Targeted/Restricted Mode runs exited independently; later normal Cmd+Q also ended further full-test
applications with Exit 0. Installed package quits normally.

An apparent native undo defect was actually QWERTZ automation mapping: command+z sent Y and command+y sent Z.
A separate VSIX built/installed directly from 7f4485d confirmed byte-exact undo/redo without application changes.
Provisional keyboard forwarding and additional DOM test were fully reverted. The 59-test runs created during
investigation are exploratory evidence, not the release-state test count.

## CI finding and fix

[CI for the checked commit](https://github.com/strxngewxrld/report-builder/actions/runs/39630124842) passed Linux
but failed Windows before integration:

```text
Could not find 'D:\a\report-builder\report-builder\out\test\*.test.js'
```

CI used Node 20.20.2, whose Windows test invocation did not expand globs; test-electron/vsce also require Node
22 minimum. Both Node configurations in `.github/workflows/ci.yml` changed to 24. Additional local check with
literal globs as Node 24.22.0 process arguments, without shell expansion: **162/162 passed**. Tests the exact
previous file-resolution failure, not a new Windows CI run. README/CHANGELOG document Node 24.

## Artifacts and limits

Logs/native copies: `artifacts/qa-macos-2026-10-21/` (Git-ignored). Key evidence: `typecheck.log`, `unit.log`,
`unit-literal-globs.log`, `corpus.log`, `integration-en-final.log`, `integration-de-final.log`, `untrusted-en.log`,
`untrusted-de.log`, `native-baseline-undo.json`, `native-baseline-edited.rdl`, `native-preview.png`,
`native-pdf-preview.png`, `package-release.log`, `install-release.log`.

VSIX `artifacts/bc-report-builder-1.0.0.vsix`; checksum in QA `release-vsix.sha256`. Final application package
contains no undo/redo code change; bundles match the natively tested baseline. This round changed CI/docs.

Complete VoiceOver/NVDA coverage of all dialog variants, further cloud/Docker targets, actual drillthrough-server
navigation and all native conflict/design variants remain separate acceptance areas. Local checks do not replace them.
