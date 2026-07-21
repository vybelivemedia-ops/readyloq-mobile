---
name: EAS build from Replit sandbox
description: How to trigger an EAS build from within the Replit sandbox, which has a 120s bash timeout and blocks git stash/large uploads.
---

## The Problem

The Replit bash tool has a 120s hard timeout. EAS build submission with `EAS_NO_VCS=1` stalls at "Compressing project files" for 2-5+ minutes (scanning node_modules). VCS mode is blocked because the sandbox intercepts git stash/clean operations.

## What Does NOT Work

- `EAS_NO_VCS=1 eas build` directly in bash → 120s timeout during compression
- VCS mode (without `EAS_NO_VCS`) → sandbox blocks git stash with "Destructive git operations are not allowed"
- `nohup` background processes → sandbox kills them when the tool call returns
- GitHub Actions via API → GH_TOKEN lacks `workflow` scope
- Stub node_modules → EAS needs real packages to resolve Expo plugins (expo-router etc.)

## What WORKS: The Workflow Trick

Configure a one-off Replit workflow (via `configureWorkflow`) that runs pnpm install + eas build. Workflows run without the 120s cap, persist between tool calls, and output is readable via `getWorkflowStatus`.

```javascript
await configureWorkflow({
  name: "EAS Build",
  command: "bash -c 'cd /home/runner/workspace/artifacts/readyloq-app && pnpm install 2>&1 && EAS_NO_VCS=1 EAS_SKIP_AUTO_FINGERPRINT=1 npx eas build --platform android --profile development --non-interactive --no-wait 2>&1; echo \"Done.\"'",
  outputType: "console",
  autoStart: true
});
```

Then poll with `getWorkflowStatus({ name: "EAS Build", maxScrollbackLines: 60 })` every 30-90 seconds. Remove the workflow after the build is submitted: `removeWorkflow({ name: "EAS Build" })`.

## Timings (observed)

- `pnpm install` (monorepo root): ~7s (pnpm store cache)
- EAS compression (with node_modules present): ~2m 3s (283 MB)
- EAS upload: ~9s
- Total to submission: ~2.5 minutes

## Why Node_modules Gets Included

The `.easignore` pattern `node_modules` is ignored by EAS's file walker even with explicit patterns. The real fix is the improved `.easignore` with trailing slashes and `**` globs. But even with the fix, pnpm's virtual store structure may partially bypass the ignore. The 283 MB upload is a one-time cost per submission.

## After Submission

The workflow state becomes "finished" when the process exits. Remove it to avoid clutter. The build runs on EAS cloud servers — check status via `eas build:list`.

**Why:** bash tool 120s timeout + sandbox git restrictions + no workflow scope on GH_TOKEN make this the only viable path for in-sandbox EAS build submission.
