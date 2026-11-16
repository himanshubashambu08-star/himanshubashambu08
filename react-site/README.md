# Himanshu's Little World

A playable portfolio. The hand-drawn map from the profile README becomes a small world you walk through: every building is an app, and stepping inside stamps your passport.

```bash
npm install
npm run dev
```

## How it plays

- Move with arrow keys / WASD, or tap where you want to go. `E` steps inside a building.
- 10 places = 10 apps. Each visit stamps the passport and moves the sky from dawn to night.
- Chai cups and story pages are scattered on the map. A boat sails "beyond the map" after 5 stamps.
- Visiting all 10 turns on the lighthouse, the stars and a fireworks finale with contact links.
- **Read mode** (`#read`) shows the same content on one plain page. Progress is saved in the browser.

## Where things live

- `src/game/data.ts`: all the content (places, story, skills, contact). Edit text here.
- `src/game/World.tsx`: the map, traveller, camera, pickups, day/night.
- `src/game/Game.tsx`: HUD, dock, passport, backpack, journal, finale.
- `src/Intro.tsx`, `src/ReadMode.tsx`: start screen and the plain page.
- `public/world.svg` and `src/game/character.ts`: artwork taken from `../assets/map.svg`.

## React Bits

Components in `src/components/` come from [React Bits](https://reactbits.dev): Aurora, SplitText, BlurText, ShinyText, GradientText, Magnet, ClickSpark, Dock, Particles, FadeContent, SpotlightCard, TiltedCard. Add more with:

```bash
npx shadcn@latest add https://reactbits.dev/r/<Component>-TS-TW
```

## MotionSites

Two layouts are adapted from free [MotionSites](https://motionsites.ai) designs, with this site's own content and artwork:

- Start screen: "AI Trip Planner" (typewriter wordmark, frosted-glass prompt card, top fade over a moving background).
- Read mode header: "Maya Lind Profile" (intro with avatar, bento grid of live cards).
