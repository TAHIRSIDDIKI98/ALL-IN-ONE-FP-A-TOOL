import { useId, useRef, type ReactNode } from 'react'

/** Automatic-activation tabs: one tab stop, Arrow keys, Home/End, labeled panel. */
export function Tabs<T extends string>({ value, onChange, items, label, children, compact = false }: {
  value: T; onChange: (value: T) => void;
  items: { value: T; label: ReactNode }[]; label: string; children: ReactNode; compact?: boolean;
}) {
  const id = useId()
  const list = useRef<HTMLDivElement>(null)
  const active = items.findIndex(item => item.value === value)
  return <div className={compact ? 'tabs-container compact-tabs' : 'tabs-container'}>
    <div ref={list} className="page-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => <button key={item.value} id={`${id}-tab-${index}`} type="button" role="tab"
        aria-selected={value === item.value} aria-controls={`${id}-panel`} tabIndex={value === item.value ? 0 : -1}
        className={value === item.value ? 'active' : ''} onClick={() => onChange(item.value)}
        onKeyDown={event => {
          let next = index
          if (event.key === 'ArrowRight') next = (index + 1) % items.length
          else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = items.length - 1
          else return
          event.preventDefault(); onChange(items[next].value)
          list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>{item.label}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`} tabIndex={0} className="tab-panel">{children}</div>
  </div>
}
