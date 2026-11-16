// All content comes from the profile README of this repository.

export type Place = {
  id: string
  emoji: string
  place: string
  app: string
  tagline: string
  story: string
  why: string
  tech: string[]
  link?: { label: string; href: string }
  /** Door position in map units (the map is 1000 x 640). */
  x: number
  y: number
  /** Centre of the building's little island, for glow and markers. */
  cx: number
  cy: number
  color: string
}

export const PLACES: Place[] = [
  {
    id: 'garden',
    emoji: '🏡',
    place: 'The Kitchen Garden',
    app: 'PrepMate',
    tagline: 'plans your meals & grocery list',
    story:
      'Every week the same question: "what do we cook?" Here, you just say what you like, how much you want to spend and how busy you are. The garden plans your whole week, hands you the recipes and writes your grocery list. Show it a photo of your shopping bill and it remembers what\'s already in your kitchen.',
    why: 'Less wasted food, less wasted money, more quiet evenings.',
    tech: ['React', 'OpenAI', 'Stripe'],
    x: 122, y: 232, cx: 130, cy: 200, color: '#E3A99A',
  },
  {
    id: 'fuel',
    emoji: '⛽',
    place: 'The Old Fuel Stop',
    app: 'Fuel Receipts',
    tagline: 'reads gas receipts for tax time',
    story:
      'Paper receipts fade and get lost in car doors. Here, you take a photo and the app reads the date, litres, price and tax for you. When tax season comes, it tells you what you can claim and makes a neat report for your accountant.',
    why: "People who drive for work deserve every dollar they're owed.",
    tech: ['Firebase', 'Gemini', 'Works offline'],
    link: { label: 'Step inside the live app', href: 'https://himanshubashambu08-star.github.io/himanshubashambu08/' },
    x: 327, y: 207, cx: 335, cy: 175, color: '#E9C58F',
  },
  {
    id: 'cafe',
    emoji: '🥐',
    place: 'Little Paris Café',
    app: 'FluentFast B2',
    tagline: 'a kind AI teacher for French',
    story:
      'A small café where a kind French teacher with a drawn face listens to you speak. It gently tells you which sounds and words need a little work, and brings old words back right before you forget them.',
    why: 'To help English speakers reach confident French in about 90 days.',
    tech: ['React', 'OpenAI voice'],
    x: 537, y: 232, cx: 545, cy: 200, color: '#C9B3DA',
  },
  {
    id: 'truck',
    emoji: '🚚',
    place: 'The Truck Yard',
    app: 'Trucking POD Manager',
    tagline: 'delivery papers, sent in one click',
    story:
      'Drivers come back from long roads with delivery papers in their pockets. Here, they snap a photo on their phone, and the office finds every paper in one tidy place, ready to send to the broker in one click.',
    why: 'No paper, no payment. So the paper should never get lost.',
    tech: ['React', 'Express', 'PostgreSQL'],
    x: 737, y: 207, cx: 745, cy: 175, color: '#A9C2D6',
  },
  {
    id: 'lighthouse',
    emoji: '💡',
    place: 'The Lighthouse',
    app: 'Stella · AI receptionist',
    tagline: 'answers calls & books visits 24/7',
    story:
      'The light that never goes out. When a small shop is too busy to pick up the phone, Stella answers, talks kindly like a real person, and books the appointment straight into the calendar, day or night.',
    why: 'Every missed call is a customer who walked away.',
    tech: ['Vapi voice', 'Make.com', 'Google Calendar'],
    x: 887, y: 342, cx: 895, cy: 310, color: '#F4D58D',
  },
  {
    id: 'post',
    emoji: '📮',
    place: 'The Post Office',
    app: 'AI Outreach Agent',
    tagline: 'finds & writes to new clients',
    story:
      'Every morning, the postman goes out and finds small businesses that might need help, looks at their websites, and drafts a warm, personal letter for each one. I read every letter before it leaves.',
    why: "Finding new people to help shouldn't take the whole day.",
    tech: ['Mastra', 'OpenAI', 'Gmail'],
    x: 692, y: 407, cx: 700, cy: 375, color: '#E9C58F',
  },
  {
    id: 'square',
    emoji: '⛲',
    place: 'The Town Square',
    app: 'LinkedIn Outreach',
    tagline: 'friendly first hellos, no typing',
    story:
      'Where new friendships begin. It finds people who might need a website or a little automation, helps write a thoughtful first hello, and reminds me to check in on day 1, 3 and 7.',
    why: 'Good conversations, without hours of typing.',
    tech: ['Mastra', 'GPT-4o', 'PostgreSQL'],
    x: 472, y: 387, cx: 480, cy: 355, color: '#A9C2D6',
  },
  {
    id: 'cinema',
    emoji: '🎞️',
    place: 'The Little Cinema',
    app: 'SaaS Video Marketer',
    tagline: 'turns a website into a short film',
    story:
      'Hand it the address of any website. It looks around, writes a short story about it, and plays a 30-second film with a voice and soft music, ready to share.',
    why: "Small teams can't always afford a video maker.",
    tech: ['Claude', 'Puppeteer', 'FFmpeg'],
    x: 247, y: 412, cx: 255, cy: 380, color: '#C9B3DA',
  },
  {
    id: 'tower',
    emoji: '🗼',
    place: 'The Market Tower',
    app: 'Crypto Dashboard',
    tagline: 'live prices & practice trades',
    story:
      "From the top of the tower you can watch Bitcoin, Ethereum and Solana prices move in real time, test an idea on yesterday's prices, and get a calm buy, sell or wait suggestion.",
    why: 'To learn and practise without risking real money.',
    tech: ['WebSockets', 'TradingView charts'],
    x: 352, y: 562, cx: 360, cy: 530, color: '#E9C58F',
  },
  {
    id: 'library',
    emoji: '📚',
    place: 'The Quiet Library',
    app: 'FinanceAuthority',
    tagline: 'simple, honest money guides',
    story:
      'Shelves of simple, honest guides about credit cards, loans, insurance, investing and credit scores, written without the confusing words.',
    why: 'Money advice should feel like a friend explaining, not a bank talking.',
    tech: ['React', 'TypeScript'],
    x: 632, y: 567, cx: 640, cy: 535, color: '#A6BF9E',
  },
]

export type Pickup = { id: string; kind: 'chai' | 'scroll'; x: number; y: number; text?: string }

export const SCROLLS: Pickup[] = [
  { id: 's1', kind: 'scroll', x: 205, y: 300, text: 'For six years I was a bookkeeper.' },
  { id: 's2', kind: 'scroll', x: 620, y: 300, text: 'I kept the numbers tidy for more than fifty clients, and watched good people lose hours every week to the same small, boring tasks.' },
  { id: 's3', kind: 'scroll', x: 790, y: 470, text: 'So I learned to build. Slowly at first, then every day.' },
  { id: 's4', kind: 'scroll', x: 470, y: 500, text: 'Now I make little helpers for small businesses. Nothing loud. Just things that quietly make the day lighter.' },
  { id: 's5', kind: 'scroll', x: 120, y: 420, text: "I speak English, हिंदी and ਪੰਜਾਬੀ, and I'm always happy to talk about an idea over chai." },
]

export const CHAI: Pickup[] = [
  [205, 195], [420, 180], [630, 185], [820, 150], [800, 300], [575, 355],
  [350, 330], [150, 330], [280, 500], [500, 590], [730, 560], [900, 230],
].map(([x, y], i) => ({ id: `c${i}`, kind: 'chai' as const, x, y }))

export const BACKPACK: { title: string; items: string[] }[] = [
  { title: 'For building', items: ['TypeScript', 'JavaScript', 'Python', 'React', 'Node.js', 'Express', 'Next.js', 'Tailwind', 'Three.js'] },
  { title: 'For thinking', items: ['OpenAI', 'Claude', 'Gemini', 'Mastra agents'] },
  { title: 'For talking & connecting', items: ['Vapi voice', 'Make.com', 'Google Calendar', 'Gmail'] },
  { title: 'For keeping things safe', items: ['PostgreSQL', 'Supabase', 'Firebase'] },
  { title: 'For the shop', items: ['Stripe', 'Shopify', 'QuickBooks', 'Xero'] },
]

export const BEYOND = {
  houses: [
    { emoji: '🎥', name: 'The Cinematic House', text: 'my work, shown like an old movie: dark, golden and slow' },
    { emoji: '🌆', name: 'The Glowing City', text: 'a little 3D town you scroll through' },
    { emoji: '🕯️', name: 'Three small cottages', text: 'My Creative Showcase · Automation Architect · Automation Alchemy' },
  ],
  roads: [
    { emoji: '🐶', name: 'PawfectLife', text: 'a small shop for gentle pet-grooming products' },
    { emoji: '🍚', name: 'Rice import', text: 'carrying Basmati from Indian farms to Canadian kitchens' },
    { emoji: '🏸', name: 'Skyboo', text: 'a new outdoor game, still being invented' },
  ],
}

export const BOAT = { x: 905, y: 452 }
export const BOAT_NEEDS = 5

export const ME = {
  name: 'Himanshu',
  fullName: 'Himanshu Bashambu',
  city: 'London, Ontario',
  email: 'himanshubashambu08@gmail.com',
  instagram: 'https://www.instagram.com/himanshubashmbu',
  github: 'https://github.com/himanshubashambu08-star',
  intro:
    "I spent six years keeping other people's books balanced, and now I build small, quiet apps that do the boring work so people don't have to.",
}

export const RANKS = [
  'Newcomer', 'Wanderer', 'Wanderer', 'Path-finder', 'Path-finder', 'Explorer',
  'Explorer', 'Cartographer', 'Cartographer', 'Old friend', 'Citizen of the little world',
]

export const START = { x: 60, y: 300 }
export const MAP_W = 1000
export const MAP_H = 640
