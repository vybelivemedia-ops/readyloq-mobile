# Phase 5 physical Fold 7 acceptance sheet

**Status: NOT RUN.** A signed Production AAB candidate now exists: [EAS build `7167befe-d08f-4052-a7bd-0025f7990ddf`](https://expo.dev/accounts/hgwashingllc/projects/readyloq-app/builds/7167befe-d08f-4052-a7bd-0025f7990ddf), versionCode 222. The AAB has **not** been installed; it cannot be sideloaded directly. Test an authorized Production-configured installation on the physical Fold 7 only after the matching Production API/schema is ready. Record app version/build ID, Android version, device ID (non-personal), tester, date, and evidence links locally. Never infer a PASS from source tests, a browser, EAS history, or an emulator. For each row replace NOT RUN with PASS or FAIL, attach evidence, and record the observed company/user after switching.

| Case | Device action / expected result | Result | Evidence / notes |
| --- | --- | --- | --- |
| A. Account A → B | Sign in as A, capture local evidence, sign out, sign in as B; A's photos, drafts, cached screens, and uploads must be inaccessible to B. | NOT RUN | — |
| B. Company A → B | Switch company within an eligible account; A's data and pending work must not appear in B. | NOT RUN | — |
| C. Logout/login isolation | Log out, force-close, reopen, then sign in; locked screen before auth, only the newly authorized scope afterward. | NOT RUN | — |
| D. Super Admin → normal | Sign out of a Super Admin session, sign in as an ordinary account; no platform actions or cached admin content. | NOT RUN | — |
| E. Normal → Super Admin denial | As ordinary user, inspect Settings and call protected platform endpoint; no bootstrap token UI or self-elevation, API denies. | NOT RUN | — |
| F. Warm offline | Load authorized data online, disconnect, background/return; only previously verified same-scope local data is accessible. | NOT RUN | — |
| G. Cold offline | Force-close while disconnected and relaunch with cached session, then with no session; document the expected fail-closed waiting/locked states separately. | NOT RUN | — |
| H. Kill during upload | Start evidence upload, kill before registration, reopen/restore network; resume or show recoverable pending evidence without unauthorized registration. | NOT RUN | — |
| I. Network loss during sync | Disconnect during PUT/checkpoint/registration; no false success; reconnect and complete once. | NOT RUN | — |
| J. Partial sync | Interrupt after one of multiple items completes; resume remaining items without losing prior acknowledgements. | NOT RUN | — |
| K. Duplicate retry | Repeat an ambiguous upload/registration; same reservation and evidence row, no duplicate. | NOT RUN | — |
| L. Bait-station replay | Kill after station POST commits but before response, edit locally, relaunch/retry; recover one server ID and apply edit. | NOT RUN | — |
| M. Storage pressure | Simulate low device space during photo sanitization/persistence; explicit error, no raw upload or lost original draft. | NOT RUN | — |
| N. Migration | Launch with prior-version scoped and legacy-unscoped records; only authorized records appear; legacy remains quarantined. | NOT RUN | — |
| O. Mission Control | Authorized Super Admin views/action workflow; normal account denied and cannot retain old content after switch. | NOT RUN | — |
| P. Direct-ID authorization | Use owned, peer-technician, manager, and foreign-company inspection IDs; protected status/signature edits respect server roles even if UI filters are bypassed. | NOT RUN | — |

**Acceptance:** Any FAIL blocks Phase 5 until fixed or explicitly accepted with documented residual risk. Do not label a NOT RUN as PASS.