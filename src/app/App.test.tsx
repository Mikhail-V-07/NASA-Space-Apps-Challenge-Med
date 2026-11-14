import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { AppProvider } from './state/AppProvider'
import { STORAGE_KEY } from './state/persistence'

beforeEach(() => localStorage.clear())
const mount = () => render(<AppProvider><App /></AppProvider>)
describe('astronaut-first integrated application', () => {
  it('opens own health directly and hides crew selection and mission controls', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1, name: 'My Health' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Crew member')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Spacecraft' })).not.toBeInTheDocument()
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Health parameters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^HR Heart rate No data/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^PAL Physical activity level Definition pending/ })).toBeInTheDocument()
  })
  it('saves an observed manual measurement and restores it after remount', async () => {
    const user = userEvent.setup(), result = mount()
    await user.click(screen.getByRole('button', { name: /^SLP Sleep duration/ }))
    await user.type(screen.getByLabelText('Sleep duration (h)'), '7.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('status')).toHaveTextContent('Observation saved')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.state.health.observations[0]).toMatchObject({ parameterId: 'sleep_duration', value: { type: 'quantity', value: 7.5, unitId: 'h' }, origin: 'observed' })
    expect(saved.state.personal.measurements[0]).toMatchObject({ value: 7.5, origin: 'observed' })
    expect(saved.state.mission.measurements.every((r: { origin: string }) => r.origin === 'synthetic')).toBe(true)
    result.unmount(); mount()
    expect(screen.getByRole('button', { name: /^SLP Sleep duration 7\.5 h/ })).toBeInTheDocument()
  })
  it('runs a sleep scenario through detection and opens the affected profile from the ship', async () => {
    const user = userEvent.setup(); mount()
    await user.selectOptions(screen.getByLabelText('Demo user context'), 'mission')
    await user.click(screen.getByRole('button', { name: 'Mission Simulation' }))
    await user.selectOptions(screen.getByLabelText('Scenario'), 'sleep-disruption')
    const confirm = window.confirm; window.confirm = () => true
    await user.click(screen.getByRole('button', { name: 'Load scenario' })); window.confirm = confirm
    await user.click(screen.getByRole('button', { name: 'Advance 3 virtual minutes' }))
    await user.click(screen.getByRole('button', { name: 'Events & Alerts' }))
    expect(screen.getAllByText('Recovery indicators changed').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }))
    expect(screen.getByRole('button', { name: 'Acknowledged' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Spacecraft' }))
    await user.click(screen.getByRole('button', { name: /Mira Chen ·/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Crew Health' })).toBeInTheDocument()
    expect(screen.getByText('Simulation preview. These are not real health assessments.')).toBeInTheDocument()
  })
  it('keeps real assessments out of simulation previews', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: 'Daily Assessments' }))
    expect(screen.getByRole('button', { name: 'Start typing test' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Data workspace'), 'synthetic')
    expect(screen.queryByRole('button', { name: 'Start typing test' })).not.toBeInTheDocument()
  })
  it('retains invalid storage and shows recovery instead of overwriting it', () => {
    localStorage.setItem(STORAGE_KEY, 'incompatible')
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('retained unchanged')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('incompatible')
  })
  it('shows the science registry through existing navigation', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: 'Research & Sources' }))
    expect(within(screen.getByRole('main')).getByText(/No research dataset has been imported/)).toBeInTheDocument()
  })
})
