import './style.css'
import { Game } from './game.ts'
import { BIOME_LABEL } from './planet.ts'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

app.innerHTML = `
  <canvas id="game"></canvas>
  <div id="hud">
    <div class="brand">
      <h1>Aerie</h1>
      <p>Low-poly flight around a living globe</p>
    </div>
    <aside class="panel roost">
      <h2>Roost</h2>
      <div class="compass">
        <div class="dial"><div class="needle" id="nest-needle"></div></div>
        <div class="compass-text">
          <strong id="nest-range">—</strong>
          <span id="nest-steer">to the nest</span>
        </div>
      </div>
      <div class="carry" id="carry">Empty beak</div>
      <div class="brood" id="brood">—</div>
      <div class="chicks" id="chicks"></div>
    </aside>
    <div class="notice" id="notice"></div>
    <div class="danger" id="danger"></div>
    <aside class="panel controls">
      <h2>Controls</h2>
      <dl>
        <dt>W / ↑</dt><dd>Speed up only · toward 45, or tuck max</dd>
        <dt>S / ↓</dt><dd>Lift nose</dd>
        <dt>A D / ← →</dt><dd>Turns · slow yaws, fast rolls into the bank</dd>
        <dt>Space</dt><dd>Climb · gain height</dd>
        <dt>Ctrl</dt><dd>Slow down · lose height</dd>
        <dt>Shift</dt><dd id="shift-help">Tuck · sprint, max 60</dd>
        <dt>Mouse</dt><dd>Look / steer · also turns on foot</dd>
        <dt>RMB</dt><dd>Hold to look around · release to snap back</dd>
        <dt>Fly through</dt><dd>Twigs and berries to pick them up</dd>
        <dt>Nest</dt><dd>Fly close to drop off what you carry</dd>
      </dl>
      <label class="sprint">
        <span>Tuck max</span>
        <input id="sprint-cap" type="range" min="45" max="100" step="1" />
        <strong id="sprint-cap-value">60</strong>
      </label>
    </aside>
    <div class="panel readout">
      <div>
        <span class="label" id="speed-label">Speed</span>
        <strong id="speed">—</strong>
      </div>
      <div>
        <span class="label">Height</span>
        <strong id="alt">—</strong>
      </div>
      <div>
        <span class="label">Climb</span>
        <strong id="combo">—</strong>
      </div>
      <div>
        <span class="label">Biome</span>
        <strong id="biome" class="biome">—</strong>
      </div>
    </div>
    <div class="flap-meter idle" id="flap-meter">
      <div class="flap-wings" id="flap-wings" aria-hidden="true">
        <svg viewBox="0 0 160 56" width="160" height="56">
          <path class="wing left" d="M78 30 C58 8 28 6 8 22 C30 18 52 26 78 38 Z"/>
          <path class="wing right" d="M82 30 C102 8 132 6 152 22 C130 18 108 26 82 38 Z"/>
        </svg>
      </div>
      <div class="flap-target">
        <div class="flap-ring" id="flap-ring"></div>
        <div class="flap-pip" id="flap-pip"></div>
      </div>
      <span id="flap-call">Hold Space to climb</span>
    </div>
    <div class="hint">Click to capture the mouse · <em>Esc</em> releases it</div>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('Missing canvas')

const hud = document.querySelector('#hud')
const speedEl = document.querySelector('#speed')
const speedLabel = document.querySelector('#speed-label')
const altEl = document.querySelector('#alt')
const comboEl = document.querySelector('#combo')
const biomeEl = document.querySelector('#biome')
const pipEl = document.querySelector<HTMLElement>('#flap-pip')
const callEl = document.querySelector('#flap-call')
const meterEl = document.querySelector<HTMLElement>('#flap-meter')
const needleEl = document.querySelector<HTMLElement>('#nest-needle')
const rangeEl = document.querySelector('#nest-range')
const steerEl = document.querySelector('#nest-steer')
const carryEl = document.querySelector<HTMLElement>('#carry')
const broodEl = document.querySelector('#brood')
const chicksEl = document.querySelector<HTMLElement>('#chicks')
const noticeEl = document.querySelector<HTMLElement>('#notice')
const dangerEl = document.querySelector<HTMLElement>('#danger')
const sprintInput = document.querySelector<HTMLInputElement>('#sprint-cap')
const sprintValue = document.querySelector('#sprint-cap-value')
const shiftHelp = document.querySelector('#shift-help')
const game = new Game(canvas)
game.start()

if (sprintInput) {
  sprintInput.value = String(game.hud().sprintCap)
  if (sprintValue) sprintValue.textContent = sprintInput.value
  if (shiftHelp) shiftHelp.textContent = `Tuck · sprint, max ${sprintInput.value}`
  const applyCap = (): void => {
    game.setSprintCap(Number(sprintInput.value))
    const cap = game.hud().sprintCap
    sprintInput.value = String(cap)
    if (sprintValue) sprintValue.textContent = `${cap}`
    if (shiftHelp) shiftHelp.textContent = `Tuck · sprint, max ${cap}`
  }
  sprintInput.addEventListener('input', applyCap)
  sprintInput.addEventListener('pointerdown', (event) => event.stopPropagation())
  sprintInput.addEventListener('click', (event) => event.stopPropagation())
}

const CARRY_LABEL = {
  twig: 'Carrying a twig',
  berry: 'Carrying a berry',
} as const

function steerCue(bearing: number, range: number): string {
  if (range < 16) return 'you are here'
  const deg = (bearing * 180) / Math.PI
  const size = Math.abs(deg)
  if (size < 12) return 'dead ahead'
  if (size > 150) return 'turn around'
  const side = deg > 0 ? 'right' : 'left'
  if (size > 75) return `hard ${side}`
  return `bear ${side}`
}

function paintRoost(state: ReturnType<typeof game.hud>): void {
  if (needleEl) needleEl.style.transform = `rotate(${(state.nestBearing * 180) / Math.PI}deg)`
  if (rangeEl) rangeEl.textContent = `${state.nestRange.toFixed(0)}`
  if (steerEl) steerEl.textContent = steerCue(state.nestBearing, state.nestRange)
  if (carryEl) {
    carryEl.textContent = state.carrying ? CARRY_LABEL[state.carrying] : 'Empty beak'
    carryEl.classList.toggle('holding', state.carrying !== null)
  }

  if (broodEl) {
    if (!state.nestBuilt) broodEl.textContent = `Nest ${state.twigs}/${state.twigsNeeded} twigs`
    else if (state.chicks.every((c) => c.fledged)) broodEl.textContent = 'Brood fledged'
    else broodEl.textContent = `${state.chicks.filter((c) => !c.fledged).length} chicks to raise`
  }

  if (chicksEl) {
    if (chicksEl.childElementCount !== state.chicks.length) {
      chicksEl.replaceChildren(...state.chicks.map(() => document.createElement('i')))
    }
    state.chicks.forEach((chick, i) => {
      const pip = chicksEl.children[i]
      if (!(pip instanceof HTMLElement)) return
      pip.style.setProperty('--fill', `${(chick.fed / 4) * 100}%`)
      pip.classList.toggle('fledged', chick.fledged)
      pip.classList.toggle('hungry', !chick.fledged && chick.hunger > 0.62)
      pip.classList.toggle('starving', !chick.fledged && chick.hunger >= 1)
    })
  }

  if (noticeEl) {
    noticeEl.textContent = state.notice
    noticeEl.classList.toggle('show', state.notice !== '')
  }
  if (dangerEl) {
    dangerEl.style.opacity = `${(state.danger * 0.72).toFixed(2)}`
    dangerEl.classList.toggle('hunted', state.hunters > 0)
  }
}

function paintHud(): void {
  const state = game.hud()
  if (speedEl) speedEl.textContent = `${state.speed.toFixed(0)}`
  if (speedLabel) speedLabel.textContent = state.tucked ? 'Tuck' : 'Speed'
  speedEl?.classList.toggle('tuck', state.tucked)
  if (altEl) altEl.textContent = `${Math.max(0, state.altitude).toFixed(0)}`
  if (comboEl) comboEl.textContent = state.combo > 0 ? `${state.combo}` : '—'
  if (biomeEl) biomeEl.textContent = BIOME_LABEL[state.biome]
  if (callEl) callEl.textContent = state.call
  const ring = document.querySelector<HTMLElement>('#flap-ring')
  if (ring) {
    const size = 2.2 - state.beatApproach * 1.2
    ring.style.transform = `scale(${size})`
    ring.style.opacity = state.meterActive ? `${0.2 + state.beatApproach * 0.8}` : '0'
  }
  if (pipEl) pipEl.style.transform = `scale(${state.inWindow ? 1.3 : 0.8})`
  meterEl?.classList.toggle('idle', !state.meterActive)
  meterEl?.classList.toggle('active', state.meterActive)
  meterEl?.classList.toggle('hot', state.inWindow)
  meterEl?.classList.toggle('coming', state.meterActive && state.beatApproach > 0.55 && !state.inWindow)
  paintRoost(state)
  hud?.classList.toggle('hud-locked', state.locked)
  if (hud instanceof HTMLElement) {
    hud.dataset.pitch = state.pitch.toFixed(3)
    hud.dataset.yaw = state.yaw.toFixed(3)
    hud.dataset.roll = state.roll.toFixed(3)
    hud.dataset.vroll = state.visRoll.toFixed(3)
    hud.dataset.turn = state.turnStyle.toFixed(3)
    hud.dataset.auto = state.autoFlap ? '1' : '0'
    hud.dataset.hit = state.hit.toFixed(3)
  }
  requestAnimationFrame(paintHud)
}

paintHud()
