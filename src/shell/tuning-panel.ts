// src/shell/tuning-panel.ts
//
// A-20: dev-only tuning overlay. A couple of range sliders write straight into
// the live RotationTuning object the loop and input controller already read, so
// dragging a slider changes the feel immediately. The caller gates the mount
// behind ?tune, and a backtick keypress toggles visibility — normal players
// never see it. Pure DOM glue: values, defaults and persistence live in ./tuning
// (unit-tested); this file only wires sliders to that object, the same way
// main.ts is untested bootstrap.

import { type RotationTuning, saveTuning } from './tuning'

interface SliderSpec {
  key: keyof RotationTuning
  label: string
  min: number
  max: number
  step: number
  readout: (v: number) => string
}

const SLIDERS: readonly SliderSpec[] = [
  {
    key: 'turnRate',
    label: 'Turn rate',
    min: 0.5,
    max: 8,
    step: 0.5,
    // 256-unit circle at 60 Hz → seconds per revolution.
    readout: (v) => `${v.toFixed(1)} u/frame · ${(256 / v / 60).toFixed(2)} s/rev`,
  },
  {
    key: 'tapHoldDelayFrames',
    label: 'Tap/hold delay',
    min: 1,
    max: 40,
    step: 1,
    readout: (v) => `${v} frames · ${Math.round((v / 60) * 1000)} ms`,
  },
]

export function mountTuningPanel(tuning: RotationTuning): void {
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(0,0,0,0.85);' +
    'color:#0f0;font:12px monospace;padding:10px;border:1px solid #0f0;min-width:240px'

  for (const spec of SLIDERS) {
    const row = document.createElement('label')
    row.style.cssText = 'display:block;margin:6px 0'
    const value = document.createElement('span')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(spec.min)
    slider.max = String(spec.max)
    slider.step = String(spec.step)
    slider.value = String(tuning[spec.key])
    slider.style.cssText = 'width:100%;display:block'

    const refresh = (): void => {
      value.textContent = `${spec.label}: ${spec.readout(tuning[spec.key])}`
    }
    slider.addEventListener('input', () => {
      tuning[spec.key] = Number(slider.value)
      saveTuning(tuning)
      refresh()
    })
    refresh()
    row.append(value, slider)
    panel.append(row)
  }

  document.body.append(panel)

  // Backtick toggles the panel so you can dial the feel in mid-run.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Backquote') {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    }
  })
}
