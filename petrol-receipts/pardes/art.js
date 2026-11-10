// Pardes prototype: hand-drawn animated illustrations, one per place in the story.
// Every picture is an inline SVG (no image files), so the game stays small and works offline.
(function () {
  const P = (window.Pardes = window.Pardes || {});
  let uid = 0;

  const sky = (u, stops) => `<linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  const bg = u => `<rect width="360" height="200" fill="url(#${u}s)"/>`;
  // Falling snow, spread evenly; negative delays so it is already falling when drawn.
  const snow = (count, x0 = 0, w = 360, light = '#fff') => Array.from({ length: count }, (_, i) => {
    const x = x0 + ((i * 73) % w), r = 1 + (i % 3) * 0.6, d = 5 + (i % 4) * 1.3, dl = -((i * 0.83) % d);
    return `<circle class="snow" cx="${x}" cy="0" r="${r}" fill="${light}" opacity="${0.55 + (i % 3) * 0.15}" style="animation-duration:${d}s;animation-delay:${dl}s"/>`;
  }).join('');
  const stars = n => Array.from({ length: n }, (_, i) => `<circle class="twinkle" cx="${(i * 97) % 360}" cy="${(i * 41) % 90 + 6}" r="${0.8 + (i % 2) * 0.6}" fill="#fff" style="animation-delay:${-(i % 7) * 0.5}s"/>`).join('');
  const windows = (x, y, cols, rows, w, h, gx, gy, on = '#FFC857', off = '#2B3550') => {
    let out = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, lit = (i * 7 + r) % 3 !== 0;
      out += `<rect ${lit && i % 4 === 0 ? 'class="blink"' : ''} x="${x + c * gx}" y="${y + r * gy}" width="${w}" height="${h}" rx="1" fill="${lit ? on : off}" style="animation-delay:${-(i % 5)}s"/>`;
    }
    return out;
  };
  const kite = (x, y, c1, c2, delay, s = 1) => `<g class="kite" style="animation-delay:${delay}s"><path d="M${x} ${y + 18 * s} Q ${x - 30} ${y + 70} ${x - 70} ${y + 110}" fill="none" stroke="#5a3d2b" stroke-width=".6" opacity=".6"/><polygon points="${x},${y} ${x + 10 * s},${y + 10 * s} ${x},${y + 22 * s} ${x - 10 * s},${y + 10 * s}" fill="${c1}"/><polygon points="${x},${y} ${x + 10 * s},${y + 10 * s} ${x},${y + 10 * s}" fill="${c2}"/><path d="M${x} ${y + 22 * s} q 3 6 -2 11 q -4 5 1 10" fill="none" stroke="${c2}" stroke-width="1.2"/></g>`;

  const ART = {
    village: u => ({
      defs: sky(u, [[0, '#FBD38D'], [0.55, '#F4A261'], [1, '#E76F51']]),
      body: `${bg(u)}
        <circle class="sun" cx="262" cy="118" r="30" fill="#FFE8B0" opacity=".95"/>
        <path d="M0 132 q20 -14 40 -4 q16 -12 34 -2 q22 -16 46 -2 q20 -10 38 0 q24 -14 50 -2 q22 -12 44 0 q24 -12 50 -2 q20 -8 58 -4 V150 H0z" fill="#9C6B4E" opacity=".45"/>
        <rect y="140" width="360" height="60" fill="#E9C46A"/>
        <path d="M0 152 H360 M0 162 H360 M0 174 H360" stroke="#D4A940" stroke-width="2"/>
        <path d="M0 176 q90 -10 180 0 t180 0 V200 H0z" fill="#6A994E"/>
        <rect x="26" y="88" width="122" height="10" fill="#8C4F35"/>
        <rect x="32" y="96" width="110" height="68" fill="#C9805A"/>
        <rect x="44" y="102" width="86" height="15" rx="2" fill="#2A9D8F"/>
        <text x="87" y="113" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="8.5" font-weight="700" fill="#fff" letter-spacing="1.5">HARDWARE</text>
        <rect x="52" y="122" width="66" height="42" fill="#5B3A2C"/>
        <rect x="52" y="122" width="66" height="21" fill="#A7A9AC"/>
        <path d="M52 127 H118 M52 132 H118 M52 137 H118" stroke="#8D9094" stroke-width="1"/>
        <rect x="64" y="146" width="22" height="18" fill="#7A5240"/>
        ${kite(206, 30, '#E63946', '#FFB703', 0)}${kite(300, 48, '#3A86FF', '#8338EC', -1.4, 0.8)}${kite(160, 62, '#06D6A0', '#118AB2', -2.6, 0.7)}`
    }),
    canal: u => ({
      defs: sky(u, [[0, '#BFE3EE'], [1, '#FCEBD2']]),
      body: `${bg(u)}
        <circle cx="70" cy="46" r="16" fill="#FFF3C4"/>
        ${[30, 92, 250, 318].map((x, i) => `<g><rect x="${x}" y="${60 + i % 2 * 8}" width="4" height="${70 - i % 2 * 8}" fill="#B9A58E"/><ellipse class="leaf" cx="${x + 2}" cy="${58 + i % 2 * 8}" rx="${22 - i % 2 * 4}" ry="${30 - i % 2 * 6}" fill="${i % 2 ? '#7BA05B' : '#5E8C4A'}" style="animation-delay:${-i}s"/></g>`).join('')}
        <rect y="122" width="360" height="16" fill="#8DB360"/>
        <rect y="138" width="360" height="36" fill="#4F9AAE"/>
        ${[0, 1, 2, 3, 4, 5].map(i => `<path class="shimmer" d="M${20 + i * 58} ${146 + (i % 3) * 8} h26" stroke="#CDEFF5" stroke-width="2" stroke-linecap="round" style="animation-delay:${-i * 0.6}s"/>`).join('')}
        <rect y="174" width="360" height="26" fill="#7FA35A"/>
        <g transform="translate(150 98)"><circle cx="0" cy="22" r="7" fill="#2B2D42"/><circle cx="34" cy="22" r="7" fill="#2B2D42"/><path d="M-4 14 h22 l8 -14 h8 l-4 14 h8 v6 h-42z" fill="#D62828"/><rect x="2" y="2" width="14" height="6" rx="3" fill="#3D405B"/></g>`
    }),
    airport: u => ({
      defs: sky(u, [[0, '#0B1A33'], [1, '#2C4470']]),
      body: `${bg(u)}${stars(26)}
        <circle cx="300" cy="34" r="10" fill="#F1EBD3"/><circle cx="305" cy="30" r="10" fill="#0E1E3A"/>
        <rect x="0" y="118" width="230" height="44" fill="#1C2741"/>
        ${windows(8, 126, 14, 2, 10, 8, 15, 14, '#FFD27A', '#26324F')}
        <rect x="236" y="70" width="12" height="92" fill="#1C2741"/><rect x="226" y="62" width="32" height="14" rx="3" fill="#2E3E63"/><rect class="blink" x="230" y="66" width="24" height="5" fill="#8FD3FF"/>
        <rect y="162" width="360" height="38" fill="#121A2C"/>
        ${Array.from({ length: 12 }, (_, i) => `<circle class="twinkle" cx="${10 + i * 30}" cy="181" r="1.8" fill="#FFB703" style="animation-delay:${-i * 0.25}s"/>`).join('')}
        <g class="takeoff"><path d="M0 10 l40 -4 q8 0 10 4 q-2 4 -10 4 l-40 -2z" fill="#E8ECF4"/><path d="M18 8 l-10 -10 h6 l14 10z M18 12 l-8 10 h6 l12 -9z M2 8 l-4 -7 h4 l6 7z" fill="#BFC8D8"/><circle cx="46" cy="9" r="1.2" fill="#FF4D4D"/></g>`
    }),
    basement: u => ({
      defs: `${sky(u, [[0, '#2E2A33'], [1, '#1E1B21']])}<clipPath id="${u}w"><rect x="204" y="22" width="104" height="40"/></clipPath><radialGradient id="${u}g"><stop offset="0" stop-color="#FFE1A8" stop-opacity=".55"/><stop offset="1" stop-color="#FFE1A8" stop-opacity="0"/></radialGradient>`,
      body: `${bg(u)}
        <rect x="198" y="16" width="116" height="52" rx="3" fill="#56515E"/>
        <rect x="204" y="22" width="104" height="40" fill="#8EA9C9"/>
        <g clip-path="url(#${u}w)">${snow(44, 204, 104)}<path d="M204 56 q26 -6 52 0 t52 0 V62 H204z" fill="#F2F5FA"/></g>
        <path d="M256 22 V62" stroke="#56515E" stroke-width="3"/>
        <polygon points="204,62 308,62 360,200 120,200" fill="#8EA9C9" opacity=".06"/>
        <rect y="150" width="360" height="50" fill="#3A3330"/>
        <g class="sway"><line x1="110" y1="0" x2="110" y2="46" stroke="#111" stroke-width="1.5"/><circle cx="110" cy="80" r="70" fill="url(#${u}g)"/><circle cx="110" cy="50" r="6" fill="#FFE7B3"/></g>
        <rect x="18" y="150" width="96" height="18" rx="4" fill="#6C7A89"/><rect x="18" y="146" width="40" height="10" rx="4" fill="#E5E1D8"/><rect x="50" y="150" width="64" height="16" rx="3" fill="#A23E48"/>
        <rect x="132" y="156" width="90" height="16" rx="4" fill="#5B6770"/><rect x="132" y="152" width="36" height="9" rx="4" fill="#E5E1D8"/><rect x="160" y="156" width="62" height="14" rx="3" fill="#3D5A80"/>
        <rect x="246" y="160" width="92" height="16" rx="4" fill="#6B705C"/><rect x="246" y="156" width="34" height="9" rx="4" fill="#E5E1D8"/>
        <path d="M258 96 v52 M318 96 v52 M258 104 h60 M258 118 h60" stroke="#8B8C89" stroke-width="2"/>
        <path d="M266 104 v10 M280 104 v14 M296 104 v9 M306 118 v12" stroke="#C9B79C" stroke-width="5"/>`
    }),
    warehouse: u => ({
      defs: sky(u, [[0, '#33404D'], [1, '#232B33']]),
      body: `${bg(u)}
        ${[0, 1, 2, 3].map(i => `<rect class="blink-slow" x="${30 + i * 88}" y="4" width="54" height="5" rx="2" fill="#E9F1FF" style="animation-delay:${-i}s"/><polygon points="${30 + i * 88},9 ${84 + i * 88},9 ${100 + i * 88},90 ${14 + i * 88},90" fill="#E9F1FF" opacity=".05"/>`).join('')}
        ${[10, 128, 246].map(x => `<g><rect x="${x}" y="24" width="5" height="122" fill="#E07A2E"/><rect x="${x + 99}" y="24" width="5" height="122" fill="#E07A2E"/>${[52, 88, 124].map(y => `<rect x="${x}" y="${y}" width="104" height="5" fill="#E07A2E"/>`).join('')}${[0, 1, 2].map(r => [0, 1, 2].map(c => ((r + c + x) % 4 ? `<rect x="${x + 10 + c * 30}" y="${30 + r * 36}" width="${24 - ((r + c) % 2) * 4}" height="22" fill="${(r + c) % 2 ? '#C9A26B' : '#B48A55'}"/>` : '')).join('')).join('')}</g>`).join('')}
        <rect y="160" width="360" height="40" fill="#1C2227"/>
        <rect y="150" width="360" height="12" fill="#2B2F33"/>
        <path class="belt-lines" d="M0 156 H360" stroke="#5A6168" stroke-width="2" stroke-dasharray="6 10"/>
        ${[0, 1, 2].map(i => `<g class="box-move" style="animation-delay:${-i * 3}s"><rect x="0" y="132" width="${24 + i * 4}" height="18" fill="#C9A26B"/><path d="M${12 + i * 2} 132 v18" stroke="#9E7A47" stroke-width="2"/></g>`).join('')}`
    }),
    kitchen: u => ({
      defs: sky(u, [[0, '#EFE9DD'], [1, '#DCD3C3']]),
      body: `${bg(u)}
        <path d="${Array.from({ length: 9 }, (_, i) => `M${i * 40} 0 V120`).join(' ')} ${Array.from({ length: 4 }, (_, i) => `M0 ${i * 30} H360`).join(' ')}" stroke="#CFC6B5" stroke-width="1"/>
        <rect x="40" y="18" width="200" height="4" fill="#8A9399"/>
        ${[0, 1, 2, 3, 4].map(i => `<rect class="ticket" x="${50 + i * 36}" y="22" width="22" height="${26 + i % 2 * 6}" fill="#FFFDF5" style="animation-delay:${-i * 0.4}s"/>`).join('')}
        <rect y="120" width="360" height="80" fill="#9AA3A8"/><rect y="120" width="360" height="8" fill="#C3CACE"/>
        ${[[70, '#3D4448'], [170, '#4A5257'], [270, '#3D4448']].map(([x, c], i) => `<g><rect x="${x - 30}" y="${84 - i % 2 * 6}" width="60" height="${36 + i % 2 * 6}" rx="4" fill="${c}"/><rect x="${x - 34}" y="${80 - i % 2 * 6}" width="68" height="6" rx="2" fill="#6B7479"/>${[0, 1, 2].map(k => `<path class="steam" d="M${x - 14 + k * 14} 74 q -6 -10 0 -20 q 6 -10 0 -20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" style="animation-delay:${-(k + i) * 0.7}s"/>`).join('')}</g>`).join('')}`
    }),
    winter: u => ({
      defs: sky(u, [[0, '#162037'], [1, '#3A506B']]),
      body: `${bg(u)}
        <circle cx="60" cy="36" r="12" fill="#E8EEF6" opacity=".9"/>
        ${[[10, 96, 70], [86, 104, 62], [156, 92, 78], [240, 100, 66], [312, 94, 56]].map(([x, y, w], i) => `<g><rect x="${x}" y="${y}" width="${w}" height="${170 - y}" fill="${i % 2 ? '#2B3A55' : '#33435F'}"/><polygon points="${x - 6},${y} ${x + w / 2},${y - 30} ${x + w + 6},${y}" fill="#24304A"/><polygon points="${x - 6},${y} ${x + w / 2},${y - 30} ${x + w + 6},${y} ${x + w + 2},${y - 4} ${x + w / 2},${y - 24} ${x - 2},${y - 4}" fill="#EEF3FA"/>${windows(x + 10, y + 18, 2, 2, 12, 12, w - 32, 24)}</g>`).join('')}
        <rect x="214" y="70" width="3" height="100" fill="#11182A"/><path d="M215 72 q14 -8 22 0" fill="none" stroke="#11182A" stroke-width="3"/><circle cx="237" cy="74" r="3.5" fill="#FFE29A"/><polygon points="237,76 210,170 266,170" fill="#FFE29A" opacity=".13"/>
        <rect y="168" width="360" height="32" fill="#E9EEF5"/>
        <g class="drive-slow"><rect x="0" y="146" width="70" height="24" rx="4" fill="#C1272D"/>${windows(6, 150, 5, 1, 9, 8, 12, 0, '#FFE7A8')}<circle cx="14" cy="171" r="4" fill="#11182A"/><circle cx="56" cy="171" r="4" fill="#11182A"/></g>
        ${snow(34)}`
    }),
    gurdwara: u => ({
      defs: sky(u, [[0, '#F7B267'], [0.7, '#F4845F'], [1, '#F27059']]),
      body: `${bg(u)}
        <rect x="292" y="30" width="3" height="150" fill="#4A3B33"/>
        <path class="flag" d="M295 32 L338 46 L295 60z" fill="#FF8C1A"/>
        <rect x="70" y="100" width="200" height="72" fill="#F6F1E7"/>
        ${[90, 130, 170, 210, 240].map(x => `<path d="M${x} 172 v-36 q10 -14 20 0 v36z" fill="#E3D7C1"/>`).join('')}
        <path d="M120 100 q50 -76 100 0z" fill="#F6F1E7"/><path d="M170 26 v-12" stroke="#D9A441" stroke-width="3"/><circle cx="170" cy="12" r="3" fill="#D9A441"/>
        ${[78, 254].map(x => `<rect x="${x}" y="74" width="10" height="26" fill="#F6F1E7"/><path d="M${x - 2} 74 q7 -16 14 0z" fill="#F6F1E7"/>`).join('')}
        <rect y="172" width="360" height="28" fill="#C9B79C"/>
        <rect x="70" y="170" width="200" height="4" fill="#B8A486"/>`
    }),
    call: u => ({
      defs: `${sky(u, [[0, '#2A2433'], [1, '#191520']])}<linearGradient id="${u}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7C978"/><stop offset="1" stop-color="#E0895A"/></linearGradient>`,
      body: `${bg(u)}
        <circle class="pulse" cx="180" cy="100" r="74" fill="#F7C978" opacity=".08"/>
        <rect x="132" y="14" width="96" height="176" rx="14" fill="#0E0C12"/>
        <rect x="138" y="24" width="84" height="156" rx="8" fill="url(#${u}p)"/>
        <path d="M150 180 q30 -64 60 0z" fill="#8C2F39"/>
        <path d="M152 110 q28 -40 56 0 q4 30 -6 50 h-44 q-10 -20 -6 -50z" fill="#A23E48" opacity=".85"/>
        <circle cx="180" cy="104" r="17" fill="#C68B59"/>
        <path d="M163 100 q17 -26 34 0 q-4 -16 -17 -18 q-13 2 -17 18z" fill="#2B2024"/>
        <rect x="204" y="30" width="14" height="20" rx="3" fill="#2B2024" opacity=".6"/>
        <circle cx="166" cy="160" r="9" fill="#E63946"/><circle cx="194" cy="160" r="9" fill="#2A9D8F"/>
        ${[0, 1, 2].map(i => `<path class="wave" d="M${240 + i * 14} 86 q8 14 0 28" fill="none" stroke="#F7C978" stroke-width="2" stroke-linecap="round" style="animation-delay:${-i * 0.4}s"/>`).join('')}`
    }),
    grad: u => ({
      defs: sky(u, [[0, '#26384F'], [1, '#3F5B7A']]),
      body: `${bg(u)}
        ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${i * 64 - 8}" y="0" width="4" height="200" fill="#1E2C3F"/>`).join('')}
        <rect x="70" y="18" width="220" height="26" rx="3" fill="#8C2F39"/><text x="180" y="36" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700" fill="#F7E7C6" letter-spacing="2">CLASS OF THIS YEAR</text>
        ${Array.from({ length: 9 }, (_, i) => `<g><circle cx="${24 + i * 39}" cy="${170 - (i % 2) * 6}" r="11" fill="#2B2024"/><rect x="${13 + i * 39}" y="${178 - (i % 2) * 6}" width="22" height="30" rx="6" fill="#111827"/></g>`).join('')}
        ${[0, 1, 2, 3, 4].map(i => `<g class="toss" style="animation-delay:${-i * 0.55}s"><polygon points="${60 + i * 60},120 ${76 + i * 60},114 ${92 + i * 60},120 ${76 + i * 60},126" fill="#111827"/><path d="M${76 + i * 60} 120 v10" stroke="#FFB703" stroke-width="1.5"/></g>`).join('')}`
    }),
    office: u => ({
      defs: sky(u, [[0, '#A9D6E5'], [1, '#E9F5F8']]),
      body: `${bg(u)}
        <rect x="0" y="40" width="90" height="140" fill="#B8C4CC"/>${windows(10, 52, 3, 4, 16, 14, 26, 24, '#E9F5F8', '#9AA9B3')}
        <rect x="270" y="56" width="90" height="124" fill="#C5CFD6"/>${windows(280, 66, 3, 4, 16, 14, 26, 24, '#E9F5F8', '#A9B6BF')}
        <rect x="90" y="70" width="180" height="110" fill="#F2EBDF"/>
        <rect x="102" y="80" width="156" height="24" rx="3" fill="#1F1A17"/>
        <text x="180" y="96" text-anchor="middle" font-family="Fraunces,Georgia,serif" font-size="11.5" font-weight="650" fill="#F6E3CF" letter-spacing="1">FAMILY BUSINESS</text>
        <rect x="108" y="116" width="62" height="44" fill="#9CC5D3"/><rect x="190" y="116" width="62" height="64" fill="#6E8B98"/>
        <rect class="neon" x="118" y="128" width="42" height="16" rx="8" fill="none" stroke="#FF4D6D" stroke-width="2.5"/>
        <text class="neon" x="139" y="140" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="700" fill="#FF4D6D">OPEN</text>
        <rect y="180" width="360" height="20" fill="#8D99A3"/>
        <g class="drive"><rect x="0" y="166" width="44" height="16" rx="5" fill="#2A9D8F"/><rect x="8" y="160" width="24" height="9" rx="3" fill="#2A9D8F"/><circle cx="10" cy="183" r="4" fill="#1F1A17"/><circle cx="34" cy="183" r="4" fill="#1F1A17"/></g>`
    }),
    restaurant: u => ({
      defs: sky(u, [[0, '#2B1E3A'], [1, '#4C2F4F']]),
      body: `${bg(u)}${stars(14)}
        <rect x="40" y="62" width="280" height="118" fill="#3A2A2A"/>
        <rect x="60" y="74" width="240" height="30" rx="4" fill="#1A1212"/>
        <text class="neon" x="180" y="95" text-anchor="middle" font-family="Fraunces,Georgia,serif" font-size="16" font-weight="650" fill="#FFB347">Tandoor &amp; Tiffin</text>
        <rect x="64" y="116" width="100" height="58" fill="#F2B84B" opacity=".85"/><rect x="196" y="116" width="100" height="58" fill="#F2B84B" opacity=".85"/>
        ${[80, 112, 144, 212, 244, 276].map((x, i) => `<g><circle cx="${x}" cy="150" r="8" fill="#5A3D2B"/><rect x="${x - 7}" y="158" width="14" height="16" fill="#5A3D2B"/></g>`).join('')}
        <path d="M40 62 h280" stroke="#E63946" stroke-width="6"/>
        <rect y="180" width="360" height="20" fill="#241A24"/>`
    }),
    truck: u => ({
      defs: sky(u, [[0, '#FFB677'], [0.6, '#E58C8A'], [1, '#8E7DBE']]),
      body: `${bg(u)}
        <circle cx="290" cy="108" r="26" fill="#FFE3A3"/>
        <path d="M0 128 q60 -30 120 -6 q70 -36 140 -2 q50 -18 100 0 V150 H0z" fill="#6D5A8C"/>
        <rect y="146" width="360" height="54" fill="#3B3846"/>
        <path class="road" d="M0 174 H360" stroke="#F4D35E" stroke-width="3" stroke-dasharray="18 16"/>
        <g class="bob" transform="translate(96 0)"><rect x="0" y="112" width="120" height="44" rx="2" fill="#F4F1EA"/><rect x="10" y="122" width="100" height="6" fill="#E63946"/><rect x="122" y="124" width="40" height="32" rx="4" fill="#E63946"/><rect x="138" y="128" width="18" height="12" rx="2" fill="#A8DADC"/><rect x="0" y="154" width="164" height="6" fill="#22202A"/>${[16, 38, 100, 132, 152].map(x => `<circle cx="${x}" cy="162" r="7" fill="#1B1A22"/><circle cx="${x}" cy="162" r="2.5" fill="#8D8A99"/>`).join('')}</g>`
    }),
    wedding: u => ({
      defs: sky(u, [[0, '#2B1B3D'], [1, '#4A2545']]),
      body: `${bg(u)}
        ${Array.from({ length: 12 }, (_, i) => `<rect x="${i * 30}" y="0" width="15" height="70" fill="${i % 2 ? '#E63946' : '#FFB703'}" opacity=".85"/>`).join('')}
        <path d="M0 70 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0 q15 10 30 0" fill="none" stroke="#FFB703" stroke-width="3"/>
        ${[0, 1].map(k => `<path d="M0 ${96 + k * 26} Q 90 ${126 + k * 26} 180 ${96 + k * 26} T 360 ${96 + k * 26}" fill="none" stroke="#5B4B66" stroke-width="1"/>${Array.from({ length: 18 }, (_, i) => { const x = 10 + i * 20, y = 96 + k * 26 + 15 * Math.sin(Math.PI * ((x % 180) / 180)); return `<circle class="twinkle" cx="${x}" cy="${y.toFixed(1)}" r="2.6" fill="${['#FFE066', '#FF8FAB', '#9BF6FF'][i % 3]}" style="animation-delay:${-(i + k) * 0.3}s"/>`; }).join('')}`).join('')}
        ${[24, 336].map(x => Array.from({ length: 9 }, (_, i) => `<circle cx="${x}" cy="${80 + i * 11}" r="5" fill="${i % 2 ? '#FF8C1A' : '#FFB703'}"/>`).join('')).join('')}
        <rect y="172" width="360" height="28" fill="#3A1F33"/>
        <g class="dance"><circle cx="160" cy="136" r="7" fill="#C68B59"/><path d="M150 172 l4 -26 h12 l4 26z" fill="#E63946"/></g>
        <g class="dance" style="animation-delay:-.4s"><circle cx="200" cy="134" r="7" fill="#C68B59"/><path d="M190 172 l4 -28 h12 l4 28z" fill="#3A86FF"/><rect x="194" y="124" width="12" height="5" rx="2" fill="#FFB703"/></g>`
    }),
    bedside: u => ({
      defs: `${sky(u, [[0, '#E9DFD1'], [1, '#D8CCBB']])}<linearGradient id="${u}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F9C784"/><stop offset="1" stop-color="#F7A072"/></linearGradient>`,
      body: `${bg(u)}
        <rect x="200" y="20" width="120" height="96" fill="url(#${u}d)"/><circle cx="260" cy="104" r="22" fill="#FFF1C9"/><path d="M200 108 q30 -10 60 -2 q30 -8 60 0 V116 H200z" fill="#B86F52" opacity=".5"/>
        <path d="M260 20 V116 M200 68 H320" stroke="#EDE3D4" stroke-width="4"/><rect x="194" y="14" width="132" height="108" fill="none" stroke="#C9B79C" stroke-width="6"/>
        <path class="curtain" d="M176 8 h28 q-8 60 4 120 h-36z" fill="#D9A441" opacity=".85"/>
        <rect x="20" y="118" width="190" height="26" rx="6" fill="#F4F1EA"/><rect x="20" y="140" width="190" height="40" fill="#C9B79C"/><rect x="26" y="106" width="50" height="22" rx="8" fill="#FFFDF8"/>
        <path d="M70 124 q60 -10 136 0 v18 H70z" fill="#8FB8B0"/>
        <rect x="236" y="138" width="56" height="42" fill="#A98467"/><rect x="254" y="122" width="12" height="16" fill="#C8CCD0"/><rect x="256" y="124" width="8" height="3" fill="#E9ECEF"/>
        <rect y="180" width="360" height="20" fill="#B9A58E"/>`
    }),
    balcony: u => ({
      defs: sky(u, [[0, '#3D3B6E'], [0.6, '#C86B85'], [1, '#F2A65A']]),
      body: `${bg(u)}
        ${[[0, 70, 46], [50, 40, 40], [96, 84, 36], [140, 30, 52], [200, 60, 40], [246, 22, 46], [300, 70, 60]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${150 - y}" fill="#2C2A4A"/>${windows(x + 6, y + 8, Math.floor((w - 6) / 10), Math.floor((140 - y) / 14), 5, 6, 10, 14, '#FFD27A', '#36345A')}`).join('')}
        <rect y="140" width="360" height="60" fill="#1E1C34"/>
        <path d="${Array.from({ length: 19 }, (_, i) => `M${i * 20} 150 V196`).join(' ')} M0 150 H360" stroke="#C9C3D6" stroke-width="2.5"/>
        <rect x="40" y="168" width="34" height="28" rx="3" fill="#B86F52"/><rect x="54" y="120" width="5" height="50" fill="#5E4B3C"/>
        <g class="leaf"><circle cx="56" cy="116" r="22" fill="#4F7942"/>${[[46, 108], [62, 104], [54, 124], [68, 118]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#FFD60A"/>`).join('')}</g>
        <rect x="280" y="172" width="26" height="24" rx="3" fill="#7F5539"/><path d="M293 172 q-12 -20 -4 -30 M293 172 q10 -18 2 -32 M293 172 q2 -22 12 -26" stroke="#6A994E" stroke-width="3" fill="none"/>
        <g class="steam-cup"><rect x="200" y="176" width="14" height="14" rx="3" fill="#F4F1EA"/><path class="steam" d="M207 172 q-4 -8 0 -16" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>`
    })
  };

  // Which picture belongs to which scene. 'biz' means "draw the player's business".
  P.SCENE_ART = {
    ch1_open: 'village', funding: 'village', english_test: 'canal', visa_refused: 'call', visa_ok: 'village', jassi_dream: 'canal', promise_simran: 'village', airport: 'airport',
    arrival: 'basement', first_job: 'winter', call_home: 'call', manny_asks: 'basement', rent_short: 'basement', evicted: 'gurdwara', college_warning: 'call', shift_cut: 'warehouse', manny_after: 'basement', ch2_close: 'winter',
    ch3_open: 'grad', job_choice: 'winter', farah_meet: 'winter', dev_meet: 'warehouse', harjit_calls: 'call', pr_apply: 'call', lie_found: 'call', jassi_asks: 'call', pr_result: 'grad', farah_step: 'wedding', dev_idea: 'office',
    biz_choose: 'biz', biz_first: 'biz', manny_returns: 'biz', partner_moment: 'biz', home_pull: 'bedside', jassi_arrives: 'airport', big_contract: 'biz', farah_again: 'wedding', ch4_close: 'balcony',
    ch5_open: 'balcony', simran_wedding: 'wedding', maa_ill: 'bedside', maa_goodbye: 'bedside', marriage_turn: 'balcony', land_back: 'village', final_home: 'balcony', sell_biz: 'biz',
    collapse: 'bedside', fired: 'warehouse', breakdown: 'basement', biz_fail: 'biz', partner_share: 'biz', skim_found: 'biz',
    wedding_season: 'wedding', power_cut: 'village', agent_call: 'call', heater: 'basement', langar_coat: 'gurdwara', extra_shift: 'warehouse', fever: 'basement', scam_call: 'call', snowstorm: 'winter',
    injury: 'warehouse', accident: 'winter', car_breaks: 'winter', promotion: 'warehouse', rent_up: 'winter', tax_refund: 'call', manny_hospital: 'winter', cousin_wedding: 'wedding',
    inspection: 'restaurant', rate_crash: 'truck', review: 'biz', staff_quits: 'biz', client_lost: 'office', ad_spike: 'office', old_friend: 'restaurant',
    audit: 'office', papa_visit: 'biz', reunion_call: 'call', market_dip: 'biz'
  };
  const CHAPTER_ART = ['village', 'winter', 'winter', 'office', 'balcony'];

  const bizArt = s => (s.biz && s.biz.type === 'trucking' ? 'truck' : s.biz && s.biz.type === 'restaurant' ? 'restaurant' : 'office');
  P.artFor = (s, sceneId) => {
    const k = (sceneId && P.SCENE_ART[sceneId]) || CHAPTER_ART[s.chapter];
    return k === 'biz' ? bizArt(s) : k;
  };
  P.homeArt = s => {
    if (s.chapter === 0) return 'village';
    if (s.chapter === 1) return s.flags.cheap_room && s.home === 'Gurdwara guest room' ? 'gurdwara' : 'basement';
    if (s.chapter === 2) return s.job === 'warehouse' ? 'warehouse' : s.job === 'restaurant' || s.job === 'kitchen' ? 'kitchen' : s.job === 'trucker' ? 'truck' : 'winter';
    if (s.chapter === 3) return s.biz && s.biz.open ? bizArt(s) : 'winter';
    return 'balcony';
  };
  P.chapterArt = c => CHAPTER_ART[c] || 'village';

  // Returns the SVG for a picture. still=true draws it without motion (for album thumbnails).
  P.drawArt = (key, still) => {
    const make = ART[key] || ART.village, u = 'pa' + uid++, a = make(u);
    return `<svg class="art${still ? ' still' : ''}" viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${a.defs}</defs>${a.body}</svg>`;
  };
  P.ART_KEYS = Object.keys(ART);
})();
