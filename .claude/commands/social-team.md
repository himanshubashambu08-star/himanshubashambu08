---
description: Run the 6-agent social media team (research → competitors → video → edit → approval → upload)
argument-hint: "[niche or topic, optional]"
---

Run the social media team for: $ARGUMENTS

Use the subagents in `.claude/agents/` in this order, passing each one's output to the next:

1. **researcher** — viral topics in the niche (`Content/niche.md`, or the argument above).
2. **competitor-analyst** — what competitors posted and what's going viral.
3. **video-generator** — scripts + draft videos for the top topics (default: 3 videos).
4. **video-editor** — cuts, SFX, captions → `Exports/`.
5. **approval-agent** — QA + platform copy → `Content/approval-queue.md`, then STOP and ask me to approve.
6. **auto-upload** — only after I've marked items `APPROVED`; post to every connected platform.

Steps 1 and 2 can run in parallel. Never skip step 5.
At the end, give me a short summary: what was researched, what was made, what's waiting for me, and what was posted.
