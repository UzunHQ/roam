# Opening view: the camera study

The app opens on the main campus (Southlands, Digby Stuart, Froebel and Chadwick Hall), tilted. Which
camera does that best was measured, not guessed: `scripts/camera-study.mjs` tries 180 cameras at each of
four screen sizes in the real app (dev build, with the welcome card open, as on a first visit), scores
each and photographs the best three (the pictures here, `<size>-<rank>-<id>.jpg`; every score in
`scores.csv`).

**Candidates** (5 × 4 × 3 × 3 = 180 per size). Every camera starts from the main campus framed whole
between the search and the welcome card (`fitPoints` in `src/main.ts`), then:

- moved: not at all, 60 m up or down the screen, or 50 m left or right;
- zoom: 0.2 steps farther, as framed, 0.25 or 0.5 steps closer;
- tilt (pitch): 40°, 50° or 60°;
- turned (bearing): the campus's long axis runs 25° east of north (the principal axis of its
  buildings). Upright screens try 25° (the axis straight up), 10° and −10°; the wide screen tries 10°,
  −10° and −25°.

**Scores** (out of 100, plus 5):

| | criterion | measured as | points |
|---|---|---|---|
| a | Southlands, Digby Stuart, Froebel and Chadwick Hall whole, none behind the search, chips, controls, welcome card or footer | every corner of every campus building of the four areas on screen and clear of those | 30 if all, + 10 × the share that is |
| b | the main campus at least 55% of the screen | the outline round the four areas' buildings, as a share of the map you can see (not under the search, cards and buttons). Also given: *b strict*, the campus's own ground without the golf course, as a share of the whole screen | 20 × share / 55%, at most 20 |
| c | Roehampton Club's golf course at most 20% | the outline round its fairways, greens, bunkers and flags, share of the screen | 15, less above 20% |
| d | empty ground at the top at most 10% | visible ground outside the map's island above the campus's top edge, share of the screen | 15, less above 10% |
| e | no names overlap | pairs of overlapping names (areas' and places') and of overlapping pins | 10 if none |
| f | the hospital's H visible (bonus) | its pin on screen, not under a button or card | 5 |

**Chosen** (`HOME_CAMS` in `src/main.ts`): one camera per kind of screen. Phones (under 600 px wide) take
the best of 375×812 and 390×844 together (average score 86.6: second at 375, first at 390), a tablet
(600–899 px) the best at 768×1024, and a wide screen the best at 1440×900.

**What the study shows:** no camera reaches 55% (b) while keeping all four areas whole (a). Chadwick
Hall is about 600 m from Southlands, and on a phone the search, the chips, the welcome card and the
buttons take about a third of the screen. The best that keeps all four whole is 28–29% on a phone, 43%
on a tablet and 38% on a wide screen. Coming closer cuts off Southlands or Chadwick Hall. On phones the
empty ground at the top (d) stays at 12–18%: the campus's top edge is a slant, so some ground beside
Southlands always shows. Requirement (a) was put first.

## Scores

### 375x812

| # | id | pitch | bearing | zoom | move (m) | score | a: four areas whole | b: main campus region | b strict | c: golf | d: empty top | e: overlaps | f: H |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 375-092 | 40° | 10° | +0.25 | 60 down | 91.7 | ✓ 100% | 29% ✗ | 19% | 11% ✓ | 12% ✗ | 0 ✓ | ✓ |
| 2 **chosen** | 375-082 | 40° | -10° | 0 | 60 down | 87.6 | ✓ 100% | 24% ✗ | 17% | 10% ✓ | 14% ✗ | 0 ✓ | ✓ |
| 3 | 375-093 | 40° | 25° | +0.25 | 60 down | 84 | ✓ 100% | 24% ✗ | 16% | 8% ✓ | 16% ✗ | 0 ✓ | ✓ |

180 candidates; 90 keep all four areas whole; the best main-campus share among those: 29%.

### 390x844

| # | id | pitch | bearing | zoom | move (m) | score | a: four areas whole | b: main campus region | b strict | c: golf | d: empty top | e: overlaps | f: H |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 **chosen** | 390-082 | 40° | -10° | 0 | 60 down | 85.6 | ✓ 100% | 24% ✗ | 17% | 10% ✓ | 15% ✗ | 0 ✓ | ✓ |
| 2 | 390-093 | 40° | 25° | +0.25 | 60 down | 82.4 | ✓ 100% | 24% ✗ | 17% | 8% ✓ | 18% ✗ | 0 ✓ | ✓ |
| 3 | 390-083 | 40° | 10° | 0 | 60 down | 81 | ✓ 100% | 21% ✗ | 14% | 9% ✓ | 18% ✗ | 0 ✓ | ✓ |

180 candidates; 88 keep all four areas whole; the best main-campus share among those: 28%.

### 768x1024

| # | id | pitch | bearing | zoom | move (m) | score | a: four areas whole | b: main campus region | b strict | c: golf | d: empty top | e: overlaps | f: H |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 **chosen** | 768-084 | 40° | 25° | 0 | 60 down | 95.8 | ✓ 100% | 31% ✗ | 21% | 13% ✓ | 10% ✗ | 0 ✓ | ✓ |
| 2 | 768-010 | 40° | -10° | 0 | – | 95.6 | ✓ 100% | 32% ✗ | 22% | 13% ✓ | 11% ✗ | 0 ✓ | ✓ |
| 3 | 768-118 | 40° | -10° | 0 | 50 right | 95.6 | ✓ 100% | 31% ✗ | 22% | 12% ✓ | 11% ✗ | 0 ✓ | ✓ |

180 candidates; 74 keep all four areas whole; the best main-campus share among those: 43%.

### 1440x900

| # | id | pitch | bearing | zoom | move (m) | score | a: four areas whole | b: main campus region | b strict | c: golf | d: empty top | e: overlaps | f: H |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 **chosen** | 1440-132 | 50° | 10° | +0.25 | 50 right | 98.7 | ✓ 100% | 38% ✗ | 25% | 13% ✓ | 3% ✓ | 0 ✓ | ✓ |
| 2 | 1440-134 | 60° | -10° | +0.25 | 50 right | 98.3 | ✓ 100% | 36% ✗ | 24% | 8% ✓ | 8% ✓ | 0 ✓ | ✓ |
| 3 | 1440-133 | 60° | -25° | +0.25 | 50 right | 97 | ✓ 100% | 33% ✗ | 23% | 7% ✓ | 10% ✓ | 0 ✓ | ✓ |

180 candidates; 92 keep all four areas whole; the best main-campus share among those: 38%.

## Second phone study (November 2026)

On a phone the first choice cut the hospital's H at the right edge, put Chadwick Hall's name against the
zoom buttons and showed a wide band of empty ground at the top. A second study (same script, as a
returning visitor: no welcome card) tried 192 more cameras at 375×812 and 390×844: tilt 40°, turned −25°,
−20°, −15° or −10°, 0.1, 0.2 or 0.3 steps closer, moved 60–150 m up the screen and 0–45 m right. Three
checks were added to the score: the H's whole pin on screen and clear of every button (+10, or −10), the
golf course at most 15% (+5, less above), and Chadwick Hall's name at least 12 px from the controls (+5).

**Chosen** (`HOME_CAMS.phone`): tilt 40°, turned −20°, 0.2 steps closer, 150 m up the screen. It came
first at both sizes. At 375×812, against the first choice measured the same way: 105.5 points (was
67.7), the H whole (was cut), Chadwick Hall's name 47 px from the controls (was 12), the campus 25% of the
map you can see (was 21%), empty ground at the top 16% (was 22%), the golf course 10% (was 9%), no names
overlapping.
Pictures: `phone-2-375x812-375-006.jpg`, `phone-2-390x844-390-006.jpg`.
