import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Dashboard from './Dashboard'

describe('Dashboard', () => {
  it('renders without crashing', () => {
    render(<Dashboard />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders stat card labels', () => {
    render(<Dashboard />)
    expect(screen.getByText('Total Balance')).toBeInTheDocument()
    expect(screen.getByText('Daily P&L')).toBeInTheDocument()
    expect(screen.getByText('Total P&L')).toBeInTheDocument()
    expect(screen.getByText('Open Positions')).toBeInTheDocument()
  })

  it('renders section headings', () => {
    render(<Dashboard />)
    expect(screen.getByText('Recent AI Decisions')).toBeInTheDocument()
    expect(screen.getByText('Recent Alerts')).toBeInTheDocument()
  })

  it('shows bankroll balance after data loads', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/\$1,000\.00/)).toBeInTheDocument()
    })
  })

  it('shows decision dashboard text after data loads', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('BTC showing uptrend momentum')).toBeInTheDocument()
    })
  })

  it('shows recent alert title after data loads', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('High Volatility Detected')).toBeInTheDocument()
    })
  })
})
