# Design lock

The current Ripple Radar interface is frozen.

Do not change:

- layout, spacing, or alignment
- colors, typography, or theme tokens
- CSS or Tailwind classes
- component structure or arrangement
- copy placement
- navigation

Fixes are functionality, data, and logic only. A bug that cannot be fixed without a visual change stays unfixed until someone approves that change. Say so in the report. Do not sneak the visual change in.

Live data may change what a page shows. That is not a design change. Sample or fixture data stays labeled as such. Do not invent prices, prints, or research conclusions to fill a gap.

## Morning briefing

`/brief` includes the morning briefing above the existing personal brief: summary, market mood, what matters today, six sentiment bots, levels to watch, and today's calendar. It is built from the existing `Panel`, `Badge`, `Button`, and `Empty` components and the type styles already used on the desk.

Do not restyle that section or replace it with a new visual system. The design owner will do the visual pass. Do not change the layout, navigation, or styles of any other page.
