# Ghar Design Studio

A Roomly-style home design app that runs in the browser. You design both the **interior** (rooms) and the **exterior** (the whole house and plot) in a live 3D view, and it keeps suggesting new design options.

No install and no account needed. Open `index.html` in a browser, or host the folder anywhere (Firebase, GitHub Pages, Netlify). Three.js loads from the jsDelivr CDN, so the page needs internet the first time.

## Interior designer
- **5 room types:** Living, Bedroom, Kitchen, Dining, Home Office. Each one starts with a ready-made furnished layout.
- **8 design styles:** Modern, Scandinavian, Indian Royal, Industrial, Luxury, Boho, Minimal, Coastal. Each style changes the walls, floor, fabrics, wood and metal finishes.
- **Room size:** width, length and ceiling height in metres.
- **Wall colour and feature wall:** the Industrial style gives you an exposed-brick feature wall.
- **Flooring:** wood, marble, tiles, carpet or concrete, each in several shades.
- **Lighting mood:** daylight, warm, evening (the lamps glow) or cool.
- **Live editing:** drag furniture to move it, tap a piece to recolour, rotate, duplicate or delete it, and add new pieces from the catalogue (sofa, L-sofa, bed, wardrobe, jhoola swing, kitchen island, dining set and more).
- **🔀 New layout:** gives you a different furniture arrangement each time you tap it.

## Exterior designer
- **6 house styles:** Modern Box, Contemporary (with a cantilevered upper floor), Kerala Sloped, Villa, Colonial (with shutters) and Farmhouse.
- **Floors:** G, G+1 or G+2, plus the house width.
- **Roof:** flat terrace (with water tank and solar panels), sloped gable or hip, in any colour.
- **Colours:** walls, plus trim and window frames.
- **Features:** balcony with glass railing, car porch with a car, swimming pool, boundary wall with gate, verandah columns.
- **Garden:** lawn, paved or zen gravel, a tree count, and a "rearrange" button.
- **Time of day:** day, sunset or night. At night the windows and garden lamps light up.

## For both
- **✨ Show new options:** renders 8 fresh design variations as preview cards. Tap a card to apply it, then keep editing.
- **Views:** 🧊 3D orbit (walls nearest the camera hide automatically, like a dollhouse), 📐 top-down plan, 🚶 walk-through at eye level (drag to look around, W A S D or the arrow keys to move), 🔄 auto tour.
- **💾 Save:** keeps your designs in this browser so you can reopen them later.
- **📸 Photo:** captures an image of the current view.
