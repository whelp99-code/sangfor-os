export interface ToggleSwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function ToggleSwitch({ label, checked, onChange, disabled }: ToggleSwitchProps) {
  const id = `toggle-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
          ${checked ? 'bg-brand-600' : 'bg-gray-300'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
      <label htmlFor={id} className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>{label}</label>
    </div>
  )
}
