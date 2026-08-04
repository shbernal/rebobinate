type ToggleProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  size?: 'large' | 'small'
  disabled?: boolean
}

/**
 * An on/off slider. The visible track and knob are the sibling `<span>`; the
 * checkbox itself stays in the DOM, transparent and zero-sized, so the control
 * keeps a real checkbox's keyboard and screen-reader behaviour.
 */
const Toggle = ({
  label,
  checked,
  onChange,
  size = 'small',
  disabled = false,
}: ToggleProps) => (
  <label className={size === 'small' ? 'switch switch-small' : 'switch'}>
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={event => onChange(event.target.checked)}
    />
    <span className="slider" />
  </label>
)

export default Toggle
