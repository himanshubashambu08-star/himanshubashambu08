/* Ghar Banao: static game data. Units are feet; 1 gaj = 9 sq ft. */
'use strict';

const GAJ = 9;

// circ: open-plan family (no wall between two of these). open: half-outdoor. outdoor: no walls, no slab.
const ROOM_TYPES = {
  living:  { name: 'Drawing / Hall',  short: 'Hall',     color: '#F2D49B', min: [9, 10], hab: true, circ: true },
  bedroom: { name: 'Bedroom',         short: 'Bedroom',  color: '#B9D3EC', min: [9, 10], hab: true, bed: true },
  master:  { name: 'Master Bedroom',  short: 'Master',   color: '#9FBFE6', min: [10, 11], hab: true, bed: true },
  kitchen: { name: 'Kitchen (Rasoi)', short: 'Kitchen',  color: '#F2AF9C', min: [7, 8],   hab: true },
  dining:  { name: 'Dining',          short: 'Dining',   color: '#F5DDB0', min: [8, 8],   circ: true },
  bath:    { name: 'Bathroom',        short: 'Bath',     color: '#AEE0DA', min: [5, 7] },
  pooja:   { name: 'Pooja Ghar',      short: 'Pooja',    color: '#FFD072', min: [4, 4] },
  stairs:  { name: 'Seedhi (Stairs)', short: 'Seedhi',   color: '#D6CDC4', min: [7, 10],  circ: true },
  lobby:   { name: 'Lobby / Lounge',  short: 'Lobby',    color: '#E8DCC6', min: [5, 5],   circ: true },
  study:   { name: 'Study / Office',  short: 'Study',    color: '#C8E0B8', min: [8, 8],   hab: true },
  store:   { name: 'Store',           short: 'Store',    color: '#D6CEE8', min: [4, 4] },
  balcony: { name: 'Balcony',         short: 'Balcony',  color: '#CFEBC0', min: [3, 4],   open: true },
  parking: { name: 'Car Parking',     short: 'Parking',  color: '#C9C9C9', min: [9, 15],  open: true },
  lawn:    { name: 'Lawn / Garden',   short: 'Lawn',     color: '#93D07F', min: [4, 4],   outdoor: true },
};
const ROOM_ORDER = ['living', 'bedroom', 'master', 'kitchen', 'dining', 'bath', 'pooja', 'stairs', 'lobby', 'study', 'store', 'balcony', 'parking', 'lawn'];

// Furniture footprints in feet (w along x, d along y at rot 0; the front faces the road side).
const FURNITURE = {
  bed:      { name: 'Double Bed',    w: 6,   d: 6.5, price: 35000, color: '#8A5A3B', rooms: ['bedroom', 'master'] },
  sbed:     { name: 'Single Bed',    w: 3.5, d: 6.5, price: 18000, color: '#9B6B48', rooms: ['bedroom', 'study'] },
  wardrobe: { name: 'Almirah',       w: 6,   d: 2,   price: 40000, color: '#6E4B33', rooms: ['bedroom', 'master'] },
  sofa:     { name: 'Sofa',          w: 7,   d: 3,   price: 45000, color: '#5F7D95', rooms: ['living', 'lobby'] },
  chair:    { name: 'Arm Chair',     w: 3,   d: 3,   price: 12000, color: '#C07A4E', rooms: ['living', 'master', 'lobby'] },
  ctable:   { name: 'Center Table',  w: 4,   d: 2,   price: 9000,  color: '#7A5136', rooms: ['living'] },
  tv:       { name: 'TV Unit',       w: 6,   d: 1.5, price: 55000, color: '#3B3B3B', rooms: ['living', 'master', 'lobby'] },
  dtable:   { name: 'Dining Table',  w: 6,   d: 5,   price: 38000, color: '#7A5136', rooms: ['dining'] },
  counter:  { name: 'Kitchen Slab',  w: 8,   d: 2,   price: 90000, color: '#E9E4DA', rooms: ['kitchen'] },
  fridge:   { name: 'Fridge',        w: 2.5, d: 2.5, price: 32000, color: '#C9CED3', rooms: ['kitchen', 'dining'] },
  wc:       { name: 'WC (Toilet)',   w: 2,   d: 2.5, price: 12000, color: '#F4F4F4', rooms: ['bath'] },
  basin:    { name: 'Wash Basin',    w: 2,   d: 1.5, price: 6000,  color: '#F4F4F4', rooms: ['bath', 'dining'] },
  shower:   { name: 'Shower',        w: 3,   d: 3,   price: 15000, color: '#BFE3F0', rooms: ['bath'] },
  tub:      { name: 'Bath Tub',      w: 5.5, d: 2.5, price: 45000, color: '#F4F4F4', rooms: ['bath'] },
  mandir:   { name: 'Mandir',        w: 3,   d: 1.5, price: 20000, color: '#C8963E', rooms: ['pooja', 'living'] },
  desk:     { name: 'Study Table',   w: 4,   d: 2,   price: 14000, color: '#9B6B48', rooms: ['study', 'bedroom'] },
  shelf:    { name: 'Book Shelf',    w: 3,   d: 1.2, price: 11000, color: '#7A5136', rooms: ['study', 'living'] },
  washer:   { name: 'Washing Machine', w: 2.2, d: 2.2, price: 28000, color: '#E6E8EA', rooms: ['bath', 'store', 'balcony'] },
  car:      { name: 'Car',           w: 6,   d: 14,  price: 0,     color: '#B23A3A', rooms: ['parking'] },
  bike:     { name: 'Scooty / Bike', w: 2,   d: 6,   price: 0,     color: '#2E5E9E', rooms: ['parking'] },
  plant:    { name: 'Gamla (Plant)', w: 1.5, d: 1.5, price: 1500,  color: '#3F8F3A', rooms: ['balcony', 'lawn', 'living', 'lobby'] },
  tree:     { name: 'Ped (Tree)',    w: 5,   d: 5,   price: 3000,  color: '#2F7A34', rooms: ['lawn'] },
  jhoola:   { name: 'Jhoola',        w: 4,   d: 3,   price: 16000, color: '#8A5A3B', rooms: ['balcony', 'lawn', 'lobby'] },
  rug:      { name: 'Carpet / Rug',  w: 6,   d: 4,   price: 7000,  color: '#A33E4F', rooms: ['living', 'master', 'bedroom'] },
  lamp:     { name: 'Floor Lamp',    w: 1.2, d: 1.2, price: 4000,  color: '#E8C36A', rooms: ['living', 'master', 'bedroom'] },
};
const FURNITURE_ORDER = ['bed', 'sbed', 'wardrobe', 'sofa', 'chair', 'ctable', 'tv', 'rug', 'lamp', 'dtable', 'counter', 'fridge', 'wc', 'basin', 'shower', 'tub', 'washer', 'mandir', 'desk', 'shelf', 'plant', 'tree', 'jhoola', 'car', 'bike'];

// Floor finishes: rate is extra rupees per sq ft over the base construction rate.
const FLOORINGS = {
  tiles:   { name: 'Vitrified Tiles', color: '#ECE7DF', line: '#D2CBC0', pattern: 'tiles', size: 2,   rate: 90 },
  marble:  { name: 'Italian Marble',  color: '#F3EFEA', line: '#C9C1B7', pattern: 'marble', size: 6,  rate: 380 },
  wood:    { name: 'Wooden Floor',    color: '#B98457', line: '#8E6038', pattern: 'wood', size: 4,    rate: 260 },
  granite: { name: 'Granite',         color: '#3E3A3A', line: '#6A6464', pattern: 'granite', size: 4, rate: 220 },
  kota:    { name: 'Kota Stone',      color: '#A8B09A', line: '#8D957F', pattern: 'tiles', size: 2,   rate: 60 },
  anti:    { name: 'Anti-skid Tiles', color: '#C9D8DC', line: '#9FB2B7', pattern: 'tiles', size: 1,   rate: 70 },
  cement:  { name: 'Cement / Paver',  color: '#A7A29B', line: '#8A857E', pattern: 'paver', size: 1,   rate: 40 },
  grass:   { name: 'Ghaas (Grass)',   color: '#6DB35A', line: '#5A9C49', pattern: 'grass', size: 4,   rate: 30 },
};
const DEFAULT_FLOOR = { living: 'marble', bedroom: 'tiles', master: 'wood', kitchen: 'granite', dining: 'marble', bath: 'anti', pooja: 'marble', stairs: 'granite', lobby: 'tiles', study: 'wood', store: 'kota', balcony: 'anti', parking: 'cement', lawn: 'grass' };

const WALL_PAINTS = ['#F7F3EA', '#F1E3C8', '#E9D3B0', '#F3D7C9', '#DCE8F0', '#D7E7D2', '#E8DDF0', '#F6E7A6', '#C9DCE6', '#E7C2B4', '#BFD3B4', '#9CB4C8', '#D9A788', '#7D9A8C', '#6D7F96', '#4C5A66'];
const DEFAULT_WALL = { living: '#F1E3C8', bedroom: '#DCE8F0', master: '#E8DDF0', kitchen: '#F7F3EA', dining: '#F1E3C8', bath: '#DCE8F0', pooja: '#F6E7A6', stairs: '#F7F3EA', lobby: '#F7F3EA', study: '#D7E7D2', store: '#F7F3EA', balcony: '#F7F3EA', parking: '#F7F3EA', lawn: '#F7F3EA' };

const EXT_PAINTS = ['#F4EFE6', '#EDE0C8', '#E5C9A0', '#D9B48C', '#F2D7B6', '#CFD6D9', '#B9C3C9', '#8E9AA3', '#59636B', '#2F363C', '#E9E2D2', '#C98E6B', '#A65E3F', '#7F8F6A', '#E7CBC4', '#B7A58F'];
const CLADDINGS = {
  none:   { name: 'Sirf Paint', rate: 0 },
  stone:  { name: 'Stone Cladding', rate: 450 },
  brick:  { name: 'Brick Tiles', rate: 300 },
  wood:   { name: 'Wooden Panels', rate: 650 },
  marble: { name: 'Marble Cladding', rate: 700 },
  dholpur:{ name: 'Dholpur Stone', rate: 520 },
};
const CLAD_WHERE = { front: 'Sirf saamne (front)', ground: 'Ground floor', all: 'Poora ghar' };
const ROOFS = { flat: 'Flat Chhat + Parapet', pergola: 'Flat + Pergola', sloped: 'Dhalwan Chhat (Sloped)' };
const RAILINGS = { glass: 'Glass Railing', steel: 'Steel Grill', concrete: 'Concrete Parapet' };
const QUALITY = {
  basic:    { name: 'Basic',    rate: 1550, note: 'Simple material, local brands' },
  standard: { name: 'Standard', rate: 1950, note: 'Achha cement, ISI wiring, branded fittings' },
  premium:  { name: 'Premium',  rate: 2700, note: 'Top brands, false ceiling, modular kitchen' },
};

// The colony map. North is up. Map units are feet.
const COLONY = (() => {
  const W = 420, H = 330, ROAD = 30;
  const roads = [
    { x: 0, y: 0, w: W, h: ROAD, name: '60 ft Main Road' },
    { x: 0, y: 120, w: W, h: ROAD, name: '30 ft Road' },
    { x: 0, y: 300, w: W, h: ROAD, name: '30 ft Road' },
    { x: 0, y: 0, w: ROAD, h: H, name: '' },
    { x: W - ROAD, y: 0, w: ROAD, h: H, name: '' },
  ];
  const rows = [
    { key: 'A', y: 30, d: 60, facing: 'N', widths: [15, 15, 20, 20, 25, 25, 30, 30, 40, 45, 45, 50] },
    { key: 'B', y: 90, d: 30, facing: 'S', widths: [15, 15, 18, 18, 20, 20, 15, 15, 18, 18, 20, 20, 25, 25, 25, 25, 30, 38] },
    { key: 'C', y: 150, d: 75, facing: 'N', widths: [24, 24, 30, 30, 36, 'MANDIR:36', 40, 40, 45, 55] },
    { key: 'D', y: 225, d: 75, facing: 'S', widths: [30, 30, 30, 'PARK:120', 36, 36, 40, 38] },
  ];
  const plots = [], places = [];
  for (const r of rows) {
    let x = ROAD, n = 0;
    r.widths.forEach((wv, i) => {
      if (typeof wv === 'string') {
        const [kind, ww] = wv.split(':');
        places.push({ kind, x, y: r.y, w: +ww, h: r.d });
        x += +ww; return;
      }
      n++;
      const corner = i === 0 || i === r.widths.length - 1;
      const nearPark = r.key === 'D' && (r.widths[i - 1] === 'PARK:120' || r.widths[i + 1] === 'PARK:120');
      const gaj = Math.round(wv * r.d / GAJ);
      let rate = r.key === 'A' ? 42000 : 36000;
      if (r.facing === 'N') rate *= 1.05;
      if (corner) rate *= 1.1;
      if (nearPark) rate *= 1.08;
      if (gaj <= 70) rate *= 0.92;
      rate = Math.round(rate / 500) * 500;
      plots.push({ id: `${r.key}-${String(n).padStart(2, '0')}`, x, y: r.y, w: wv, h: r.d, wft: wv, dft: r.d, facing: r.facing, corner, nearPark, gaj, rate, price: gaj * rate, mainRoad: r.key === 'A' });
      x += wv;
    });
  }
  return { W, H, roads, plots, places };
})();

// Client briefs. Each need is checked against plan stats (see Plan.stats).
const BRIEFS = [
  { id: 'free', name: 'Apna Sapno ka Ghar', who: 'Free mode', budget: 15000000,
    story: 'Koi client nahi, koi rok-tok nahi. ₹1.5 crore ka budget, jaisa mann kare waisa ghar banao.', needs: [] },
  { id: 'sharma', name: 'Sharma ji ka Pehla Ghar', who: 'Sharma ji, bank manager, 4 log', budget: 9500000,
    story: 'Beta, 100 gaj se bada plot ho, do manzil ka ghar, 3 bedroom, ek pooja ghar aur gaadi khadi karne ki jagah. Budget ₹95 lakh, usse upar ek paisa nahi.',
    needs: [
      { t: 'Plot 100 gaj ya bada', f: s => s.gaj >= 100 },
      { t: '2 ya zyada manzil', f: s => s.floors >= 2 },
      { t: '3 bedroom', f: s => s.beds >= 3 },
      { t: '2 bathroom', f: s => s.count.bath >= 2 },
      { t: 'Pooja ghar', f: s => s.count.pooja >= 1 },
      { t: 'Car parking', f: s => s.count.parking >= 1 },
      { t: 'Kitchen', f: s => s.count.kitchen >= 1 },
    ] },
  { id: 'chhota', name: 'Chhota Parivar', who: 'Riya & Aman, naya shaadi-shuda', budget: 4500000,
    story: 'Humein chhota sa cute ghar chahiye: 50-70 gaj, 2 bedroom, ek balcony jahan chai pee sakein. Budget tight hai, ₹45 lakh.',
    needs: [
      { t: 'Plot 70 gaj tak', f: s => s.gaj <= 70 },
      { t: '2 bedroom', f: s => s.beds >= 2 },
      { t: 'Balcony', f: s => s.count.balcony >= 1 },
      { t: 'Kitchen + 1 bath', f: s => s.count.kitchen >= 1 && s.count.bath >= 1 },
    ] },
  { id: 'joint', name: 'Joint Family Haveli', who: 'Chaudhary parivar, 11 log', budget: 30000000,
    story: 'Teen bhai, unke bachche aur Dadi. 200 gaj se upar, 3 manzil, 6 bedroom, 4 bathroom, bada hall aur lawn. Budget ₹3 crore.',
    needs: [
      { t: 'Plot 200 gaj+', f: s => s.gaj >= 200 },
      { t: '3 manzil', f: s => s.floors >= 3 },
      { t: '6 bedroom', f: s => s.beds >= 6 },
      { t: '4 bathroom', f: s => s.count.bath >= 4 },
      { t: 'Lawn / Garden', f: s => s.count.lawn >= 1 },
      { t: 'Hall 250 sq ft+', f: s => s.maxArea.living >= 250 },
    ] },
  { id: 'vastu', name: 'Vastu wale Gupta ji', who: 'Gupta ji, jyotish mein poora vishwas', budget: 12000000,
    story: 'Rasoi agni kon (South-East) mein, pooja ishan (North-East) mein, master bedroom nairitya (South-West) mein. Main darwaza North ya East. Ye sab hona chahiye!',
    needs: [
      { t: 'Kitchen South-East mein', f: s => s.vastu.kitchenSE },
      { t: 'Pooja North-East mein', f: s => s.vastu.poojaNE },
      { t: 'Master bedroom South-West', f: s => s.vastu.masterSW },
      { t: 'Main darwaza North/East', f: s => s.vastu.doorNE },
    ] },
  { id: 'rent', name: 'Kiraye wali Building', who: 'Malhotra ji, investor', budget: 16000000,
    story: 'Har manzil alag family ko kiraye pe dunga. 3 manzil, har floor pe apni kitchen aur bathroom. Seedhi har floor tak jaani chahiye.',
    needs: [
      { t: '3 manzil', f: s => s.floors >= 3 },
      { t: 'Har floor pe kitchen', f: s => s.floorsWith.kitchen >= s.floors && s.floors >= 3 },
      { t: 'Har floor pe bathroom', f: s => s.floorsWith.bath >= s.floors && s.floors >= 3 },
      { t: 'Seedhi sab floors se judi', f: s => s.stairsOk && s.floors >= 3 },
    ] },
];

const BHK_PRESETS = { 1: '1 BHK', 2: '2 BHK', 3: '3 BHK', 4: '4 BHK', 5: '5+ BHK' };
