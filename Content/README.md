# Content — 6-agent social media team

| # | Agent | File | Writes to |
|---|-------|------|-----------|
| 1 | Researcher | `.claude/agents/researcher.md` | `Content/Research/` |
| 2 | Competitor Analysis | `.claude/agents/competitor-analyst.md` | `Content/Competitors/` |
| 3 | Video Generator | `.claude/agents/video-generator.md` | `Content/Scripts/`, `Raw/` |
| 4 | Video Editing | `.claude/agents/video-editor.md` | `Exports/` |
| 5 | Approval | `.claude/agents/approval-agent.md` | `Content/approval-queue.md`, `Approved Videos/` |
| 6 | Auto Upload | `.claude/agents/auto-upload.md` | posts to your connected accounts |

**Run it:** type `/social-team` in Claude Code (optionally followed by a niche), or ask for one agent by name, e.g. "use the competitor-analyst agent".

**Set up once:**
1. Write your niche in `Content/niche.md`.
2. List competitor handles in `Content/competitors.md`.
3. Fill `Brand Kit/` and `Editing Style/`.
4. Connect a publishing tool (Tella, OpusClip, Zapier/Buffer…) for auto-upload.
