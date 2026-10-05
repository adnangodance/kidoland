Sidebar SVG references from https://www.kimi.com/, inspected on 2026-10-05 at the user's request for matching text, icons, and effects.

The static SVG markup, keyframes, and SVG animation values were extracted from the site's public `index-CRcurElu.js` asset using a TypeScript AST parser. These files contain local SVG markup only. No Kimi JavaScript, remote asset requests, account integration, or tracking runs in Kidoland.

`KimiIcon.tsx` controls idle, enter, and leave layers and restarts SVG animations on interaction. Reduced-motion users see the idle icons. `KimiNavigation.tsx` records the copied label order and the existing Kidoland destination mapping; destination tooltips and accessible names remain localized.
