# Style Guide: Animated Story Reels

Taken from the two reference reels in Drive (`References/Instagram Reels`).
Both are **faceless, fully animated vertical reels**. There is no camera footage. Each one is a
voiceover story told over 3D or motion-graphic visuals, with bold word-by-word captions and an
ending that asks viewers to comment.

## Format
- 9:16 vertical, 1080×1920, 30 or 60 fps
- Length 45–90 sec
- Voiceover narration from start to end, with background music kept low under the voice

## Style A: 3D cartoon story (reference 1)
- A first-person mystery or drama told by a cartoon character ("I"), with a twist at the end
- Simple, rounded 3D cartoon characters in a few repeating locations (backyard, kitchen, street at night)
- A new shot every **2–3 seconds**: close-ups on faces, zooms on objects, over-the-shoulder shots
- **Story props as phone screens**: lock-screen notification, news-app headline, with a cartoon finger pointing at them
- Night scenes get a night-vision camera look (green tint, REC dot, timer)
- Ends on a big tilted **"WHAT WOULD YOU DO?"** title card
- Post caption gives a choice: "Take X or Y? Comment X or Y"

## Style B: Motion-graphics "interactive" reel (reference 2)
- One big concept the viewer can join in on ("100,000 empty pods — follow and one is yours")
- Clean 2D/3D motion graphics on a dark starry background, with a glow accent colour (orange/yellow + blue)
- An on-screen **counter or stat** that animates (0 / 100,000 → 1,000 → 10,000)
- Camera moves: push-ins, rotations, flying down a corridor of numbered doors
- Uses a **"YOU"** moment to put the viewer inside the story
- Ends with a CTA: follow plus a specific thing to comment

## Captions (both styles)
- Bold heavy sans-serif (e.g. Montserrat ExtraBold / Poppins Black), white with a dark shadow
- 1–3 words on screen at a time, synced to the voice
- Style A: lower-middle of the frame. Style B: top of the frame, with upcoming words greyed out and spoken words turning white
- Keep captions clear of the right-side Instagram buttons and the bottom caption bar

## Hook and structure
1. **0–3 s hook**: a strange specific detail ("Every night at exactly 3 AM…") or a big number
2. **Build**: 3–5 escalating beats, each with a new visual
3. **Twist or reveal** around 70–80% of the way through
4. **CTA**: a question or choice that gets comments

## Production pipeline
| Step | Tool |
|---|---|
| Script and hook | Claude |
| Voiceover | ElevenLabs |
| Captions and word timings | ElevenLabs transcription |
| Style A visuals | AI image/video generation (ElevenLabs creative, Canva) with original characters |
| Style B visuals | HyperFrames / Remotion motion graphics |
| Assembly and export | FFmpeg / HyperFrames |

Use original characters, names and worlds. Don't copy the reference creators' characters or stories.
