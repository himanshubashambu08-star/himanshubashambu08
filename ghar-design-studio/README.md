# Ghar Design Studio

A Roomly-style home design app that runs in the browser. You design both the **interior** (rooms) and the **exterior** (the whole house and plot) in a live 3D view, and it keeps suggesting new design options.

No install and no account needed. Open `index.html` in a browser, or host the folder anywhere (Firebase, GitHub Pages, Netlify). Three.js loads from the jsDelivr CDN, so the page needs internet the first time.

## Design from a photo
Upload a photo of any room or house (Pinterest, a magazine, your own home) and the 3D design changes to match it. Your photo stays on screen beside the 3D view so you can compare.
- **In the hosted app (claude.ai):** Claude looks at the photo. It picks the room type, style, wall, floor and fabric colours, lighting and the furniture it can see. For a house it picks the style, roof, floors, colours, balcony, parking, pool and garden. The first time, the viewer is asked to allow this, and it uses their own Claude usage.
- **Opened as a plain file:** the app cuts away phone-screenshot bars, then reads the photo's colours (walls, floor, accents, roof) and matches the closest style. Furniture and shape are not read in this mode.

## Interior designer
- **Every room designed separately:** the home starts with a Living Room, Master Bedroom, Kitchen and Pooja Room. Add more rooms (Bedroom 2, Bathroom...), rename or delete them, and give each its own style, size, colours and furniture. "Use this style in every room" copies one look to the whole home.
- **7 room types:** Living, Bedroom, Kitchen, Dining, Home Office, Bathroom and Pooja Room. Each one starts with a ready-made furnished layout, including a mandir, toilet, wash basin, shower and bathtub.
- **21 design styles from around the world:** Global (Modern, Minimal, Luxury, Boho, Art Deco), India (Indian Royal, Rajasthani Haveli, Kerala Traditional), Asia (Japandi, Chinese Classic, Bali Tropical), Europe (Scandinavian, French Parisian, English Cottage, Mediterranean), Middle East & Africa (Moroccan, Arabian Majlis), Americas (Industrial Loft, Mid-Century, Coastal, Mexican Hacienda).
- **Room size:** width, length and ceiling height, shown in metres and feet, with the room's area in sq ft.
- **Wall colour and feature wall:** the Industrial style gives you an exposed-brick feature wall.
- **Flooring:** wood, marble, tiles, carpet or concrete, each in several shades.
- **Lighting mood:** daylight, warm, evening (the lamps glow) or cool.
- **Live editing:** drag furniture to move it, tap a piece to recolour, rotate, duplicate or delete it, and add new pieces from the catalogue (sofa, L-sofa, bed, wardrobe, jhoola swing, kitchen island, dining set and more).
- **🔀 New layout:** gives you a different furniture arrangement each time you tap it.

## Exterior designer
- **Facade details:** straight or **curved sculptural** facade (flowing slabs, a sweeping side wing), normal, large or floor-to-ceiling glass, wooden fins/louvers, jaali screen, hanging planters, cove/facade lighting, stone cladding and wood colour.
- **Plot size:** choose a common plot (20×40, 25×50, 30×40, 30×50, 30×60, 40×60, 50×80, 60×90, 100×100 ft) or type any size in feet. The app shows the plot area in **gaj** (1 gaj = 9 sq ft), sq ft and m², plus the built-up area per floor, the total, and the open space left at the front, sides and back. The house, parking, pool and garden are fitted inside the plot, and the plot's sides are labelled in the 3D view.
- **20 house styles from around the world:** Global (Sculptural Modern, Modern Box, Contemporary), India (Indian Contemporary with jaali, Kerala Sloped, Indian Villa, Rajasthani Haveli with chhatris and jharokhas), Asia (Japanese, Chinese Courtyard, Bali Villa), Europe (English Tudor, Greek Santorini with a blue dome, Spanish Villa, Swiss Chalet, Nordic Red House), Middle East & Africa (Arabian, Dubai Modern), Americas (Colonial, American Suburban, Farmhouse).
- **Floors:** G, G+1 or G+2.
- **Roof:** flat terrace (with water tank and solar panels), sloped gable or hip, in any colour.
- **Colours:** walls, plus trim and window frames.
- **Features:** balcony with glass railing, car parking (a side porch on wide plots, a front pergola on narrow ones), swimming pool, boundary wall with gate, verandah columns. If something does not fit on the plot, the app says so.
- **Garden:** lawn, paved or zen gravel, a tree count, and a "rearrange" button.
- **Time of day:** day, sunset, dusk (blue sky with the lights on) or night. At night the windows and garden lamps light up.

## For both
- **✨ Show new options:** renders 8 fresh design variations as preview cards. Tap a card to apply it, then keep editing.
- **Views:** 🧊 3D orbit (walls nearest the camera hide automatically, like a dollhouse), 📐 top-down plan, 🚶 walk-through at eye level (drag to look around, W A S D or the arrow keys to move), 🔄 auto tour.
- **💾 Save:** keeps the whole home (every room plus the exterior and plot) in this browser so you can reopen it later.
- **📸 Photo:** captures an image of the current view.
