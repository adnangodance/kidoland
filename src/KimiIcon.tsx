import { useEffect, useRef, useState } from 'react'

// Local SVG assets taken from the user's Kimi reference. No remote code runs.
const assets = import.meta.glob<string>('./assets/kimi-sidebar/*.svg', { query: '?raw', import: 'default', eager: true })
export type KimiIconName = 'newChat' | 'myKimi' | 'plugins' | 'scheduled' | 'inspiration' | 'slides' | 'deepResearch' | 'build' | 'docs' | 'sheets' | 'design' | 'kimiWork' | 'kimiCode' | 'kimiClaw' | 'openPlatform' | 'newProject' | 'sidebar' | 'more'

export default function KimiIcon({ name }: { name: KimiIconName }) {
  const wrapper = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState<'idle' | 'enter' | 'leave'>('idle')
  const svg = assets[`./assets/kimi-sidebar/${name}.svg`]

  useEffect(() => {
    if (phase === 'idle') return
    wrapper.current?.querySelectorAll<SVGAnimationElement>(`[data-animation-icon-layer='${phase}'] animate, [data-animation-icon-layer='${phase}'] animateTransform`).forEach((animation) => animation.beginElement())
  }, [phase])

  useEffect(() => {
    const element = wrapper.current
    const button = element?.closest('button, a')
    if (!element || !button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const icon = element.querySelector('svg')
    const hold = icon?.getAttribute('data-animation-icon-playback') === 'hold'
    const duration = Number(icon?.getAttribute('data-animation-icon-enter-duration') || '.4') * 1000
    let timer: ReturnType<typeof setTimeout>
    const enter = () => { clearTimeout(timer); setPhase('enter'); if (!hold) timer = setTimeout(() => setPhase('idle'), duration) }
    const leave = () => { if (!hold) return; clearTimeout(timer); setPhase('leave'); timer = setTimeout(() => setPhase('idle'), duration) }
    button.addEventListener('pointerenter', enter)
    button.addEventListener('pointerleave', leave)
    button.addEventListener('focus', enter)
    button.addEventListener('blur', leave)
    return () => { clearTimeout(timer); button.removeEventListener('pointerenter', enter); button.removeEventListener('pointerleave', leave); button.removeEventListener('focus', enter); button.removeEventListener('blur', leave) }
  }, [name])

  return <span ref={wrapper} className="kimi-icon" aria-hidden="true" data-animation-icon-wrapper="true" data-animation-phase={phase} dangerouslySetInnerHTML={{ __html: svg }} />
}
