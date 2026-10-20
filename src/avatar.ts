// The "you are here" character: a little student in a green cap.
// Two poses in one SVG; CSS shows .stand when still and .walk (with swinging limbs) when moving.
// viewBox units: the feet sit on y = 80, which the marker places on your GPS position.

const OUT = '#26313a'; // outline
const CAP = '#1e6a4c';
const CAP_DARK = '#164f39';
const CREAM = '#f4ead0';
const line = `stroke="${OUT}" stroke-width="1.9" stroke-linejoin="round"`;
const pin = (x: number, y: number) =>
  `<path d="M${x} ${y - 4.6}c-2.2 0-3.9 1.6-3.9 3.7 0 2.7 3.9 6.1 3.9 6.1s3.9-3.4 3.9-6.1c0-2.1-1.7-3.7-3.9-3.7z" fill="${CREAM}"/>` +
  `<circle cx="${x}" cy="${y - 0.9}" r="1.35" fill="${CAP}"/>`;
const eye = (x: number) =>
  `<ellipse cx="${x}" cy="31" rx="2.7" ry="3.5" fill="#1b1d21"/><circle cx="${x + 0.8}" cy="29.7" r="0.95" fill="#fff"/>`;

const stand = `
<g class="stand">
  <rect x="22.5" y="60" width="8.6" height="19" rx="4.3" fill="#fff" ${line}/>
  <rect x="32.9" y="60" width="8.6" height="19" rx="4.3" fill="#fff" ${line}/>
  <rect x="14.6" y="45" width="8" height="16" rx="4" fill="#fff" ${line} transform="rotate(24 18.6 47)"/>
  <rect x="41.4" y="45" width="8" height="16" rx="4" fill="#fff" ${line} transform="rotate(-24 45.4 47)"/>
  <rect x="20" y="43" width="24" height="24" rx="10" fill="#fff" ${line}/>
  <ellipse cx="32" cy="29" rx="22" ry="18.5" fill="#fff" ${line}/>
  ${eye(24.5)}${eye(39.5)}
  <path d="M28.6 36.4Q32 39.4 35.4 36.4" fill="none" stroke="#1b1d21" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M11.2 23.6C11.6 12.6 20.4 6.6 32 6.6S52.4 12.6 52.8 23.6Q32 20.4 11.2 23.6Z" fill="${CAP}" ${line}/>
  <path d="M23.5 9.6Q19.6 15.4 19.4 21.8M40.5 9.6Q44.4 15.4 44.6 21.8" fill="none" stroke="${CAP_DARK}" stroke-width="1.1"/>
  <path d="M10.6 23.4Q32 19 53.4 23.4Q55 27.4 51.2 27.9Q32 24.4 12.8 27.9Q9 27.4 10.6 23.4Z" fill="${CAP_DARK}" ${line}/>
  <circle cx="32" cy="6.8" r="2" fill="${CAP}" ${line}/>
  ${pin(32, 15.6)}
</g>`;

const walk = `
<g class="walk">
  <rect class="leg back" x="27.7" y="60" width="8.6" height="19" rx="4.3" fill="#f1f1f1" ${line}/>
  <g class="bob">
    <rect class="arm back" x="28.2" y="46" width="7.6" height="15.5" rx="3.8" fill="#f1f1f1" ${line}/>
  </g>
  <rect class="leg front" x="27.7" y="60" width="8.6" height="19" rx="4.3" fill="#fff" ${line}/>
  <g class="bob">
    <rect x="21" y="43" width="22" height="24" rx="10" fill="#fff" ${line}/>
    <rect class="arm front" x="28.2" y="46" width="7.6" height="15.5" rx="3.8" fill="#fff" ${line}/>
    <ellipse cx="32" cy="29" rx="20.5" ry="18.5" fill="#fff" ${line}/>
    ${eye(43)}
    <path d="M44.6 36.2Q47.6 37.8 49.8 35.6" fill="none" stroke="#1b1d21" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M12.6 24.6C12.4 13 20.6 6.6 31.6 6.6 42 6.6 49.8 12.6 51 22.6Q32 20.2 12.6 24.6Z" fill="${CAP}" ${line}/>
    <path d="M24 9.4Q19.6 15.6 19.8 22.6" fill="none" stroke="${CAP_DARK}" stroke-width="1.1"/>
    <path d="M44.5 21.6Q55.5 19.4 61.2 23.2Q60.6 26.6 56 26.4Q50 26 44.6 26.4Z" fill="${CAP_DARK}" ${line}/>
    <circle cx="31" cy="6.9" r="2" fill="${CAP}" ${line}/>
    ${pin(35.5, 16)}
  </g>
</g>`;

export const avatarSvg = `<svg class="me" viewBox="0 0 64 84" width="48" height="63" aria-hidden="true" focusable="false">
  <ellipse class="shadow" cx="32" cy="80.5" rx="13.5" ry="3.2"/>
  ${stand}${walk}
</svg>`;
