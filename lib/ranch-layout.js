/* Ranch map layout, traced from public/img/ranch-map.jpg (1536 x 1024 px).
   Shapes are in map pixels; the website and the staff pricing board scale them.
   Shapes are NOT stored in the database, so when the map art changes you only
   replace the image, update these numbers and redeploy. */

const MAP = { src: 'img/ranch-map.jpg', width: 1536, height: 1024 };

function mainBarnShapes() {
  // Rows top to bottom; odd numbers on the left, even on the right
  const rows = [[19, 20], [17, 18], [15, 16], [13, 14], [11, 12], [9, 10], [7, 8], [5, 6], [3, 4], [1, 2]];
  const ys = [88, 130, 174, 216, 259, 302, 346, 389, 432, 475, 520];
  const cols = [{ x0: 323, x1: 405 }, { x0: 481, x1: 564 }];
  const out = {};
  rows.forEach((pair, r) => pair.forEach((n, c) => {
    out['M' + n] = { x: cols[c].x0 + 2, y: ys[r] + 2, w: cols[c].x1 - cols[c].x0 - 4, h: ys[r + 1] - ys[r] - 4 };
  }));
  return out;
}

function outdoorShapes() {
  const xs = [705, 771, 838, 905, 975, 1045, 1116, 1185, 1255];
  const numbers = [8, 7, 6, 5, 4, 3, 2, 1]; // left to right on the map
  const out = {};
  numbers.forEach((n, i) => { out['O' + n] = { x: xs[i] + 2, y: 652, w: xs[i + 1] - xs[i] - 4, h: 72 }; });
  return out;
}

const SHAPES = { ...mainBarnShapes(), ...outdoorShapes() };

// Places on the map that aren't bookable; hovering shows what they are
const AREAS = [
  { id: 'main-arena', name: 'Main arena', text: 'The large lit riding arena.', shape: { x: 650, y: 72, w: 790, h: 460 } },
  { id: 'second-arena', name: 'Second arena', text: 'A second lit riding arena.', shape: { x: 885, y: 792, w: 550, h: 175 } },
  { id: 'pen-1', name: 'Round pen 1', text: 'Small round pen for lunging and groundwork.', circle: { cx: 140, cy: 125, r: 92 } },
  { id: 'pen-2', name: 'Round pen 2', text: 'Small round pen for lunging and groundwork.', circle: { cx: 128, cy: 305, r: 90 } },
  { id: 'tack', name: 'Tack rooms', text: 'Storage for saddles and gear.', shape: { x: 58, y: 410, w: 110, h: 138 } },
  { id: 'hay', name: 'Hay storage', text: 'The hay barn.', shape: { x: 58, y: 588, w: 320, h: 102 } },
  { id: 'trailer', name: 'Trailer parking', text: 'Gravel lot for trailers and RVs. Spots are limited, so contact a team member to confirm before you book.', shape: { x: 80, y: 712, w: 620, h: 263 } },
  { id: 'bath', name: 'Outdoor bathroom', text: 'Restroom for owners and riders.', shape: { x: 1380, y: 565, w: 122, h: 160 } },
];

module.exports = { MAP, SHAPES, AREAS };
