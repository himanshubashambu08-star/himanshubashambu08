# react-site

Vite + React + TypeScript + Tailwind v4, set up for [React Bits](https://reactbits.dev) components.

```bash
npm install
npm run dev
```

## Installed React Bits components (`src/components/`)

- **Text:** SplitText, BlurText, ShinyText, GradientText
- **Backgrounds:** Aurora, Particles
- **Components:** SpotlightCard, Dock, TiltedCard
- **Animations:** ClickSpark, FadeContent, Magnet

`src/App.tsx` is a demo page that uses most of them.

## Adding more

The project is configured for the shadcn CLI (`components.json`, `@/` alias):

```bash
npx shadcn@latest add https://reactbits.dev/r/<Component>-TS-TW
```

If reactbits.dev is unreachable, the same registry files are on GitHub:

```bash
npx shadcn@latest add https://raw.githubusercontent.com/DavidHDev/react-bits/main/public/r/<Component>-TS-TW.json
```
