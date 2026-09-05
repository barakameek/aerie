# Aerie

Aerie is a low-poly bird flight game on a spherical planet. You soar over hills, forests, and sea, then nest: gather twigs, raise chicks, and keep hawks and foxes away.

## Play

```bash
npm install
npm run dev
```

Open the printed local URL (default port `43180`).

Production build:

```bash
npm run build
npm run preview
```

## Controls

| Input | Action |
| --- | --- |
| **W** | Flap — short tap for a quick boost, hold for sustained climb |
| **S** | Soften / slow |
| **A / D** | Roll left / right |
| **Mouse** | Pitch and yaw look |
| **Shift** | Speed burst |
| **Ctrl** | Sink / dive |
| **R** | Restart |
| **Esc** | Pause |

## Nesting

1. **Find the nest** — spawn near a stone spire with a soft light. The roost panel shows a compass needle, range, and steer cue.
2. **Gather twigs** — swoop through glowing twigs on the ground. Carry one at a time to the nest.
3. **Build** — six twigs raise the nest; three chicks hatch.
4. **Feed** — berries fill chick hunger. Four feeds fledges a chick.
5. **Defend** — hawks stoop in the air; foxes raid when you are away. A fast low pass scares foxes off.

You only pick what the roost needs next (twigs while building, berries while feeding), so you never get stuck carrying the wrong item.

## Flight model

- Glide sink when not flapping; diving recovers energy and speed.
- Level coast without **W** gently bleeds speed (soar drag).
- Terrain landing needs low relative speed and a belly-down attitude.
- Trees use thin trunk cores; the body sphere is the collision volume.
- Sea is a floor only where water covers ground.
- Ceiling softens then hard-caps altitude so you cannot climb forever.

## Debug

| Query | Effect |
| --- | --- |
| `?hitboxes=1` | Show collision helpers |
| `?atnest=1` | Start at the nest |
| `?brood=N` | Skip build and hatch `N` chicks |
