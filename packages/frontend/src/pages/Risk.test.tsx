import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Risk from './Risk'

describe('Risk', () => {
  it('renders page title', () => {
    render(<Risk />)
    expect(screen.getByText('Risk Management')).toBeInTheDocument()
  })

  it('renders kill switch section', () => {
    render(<Risk />)
    expect(screen.getByText(/Kill Switch/)).toBeInTheDocument()
  })

  it('renders stat cards', () => {
    render(<Risk />)
    expect(screen.getByText('Total Events')).toBeInTheDocument()
    // "Critical" appears in both label and dropdown option — use getAllByText
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0)
    expect(screen.getByText('Warnings')).toBeInTheDocument()
    expect(screen.getByText('Auto-Resolved')).toBeInTheDocument()
  })

  it('renders exposure gauges after config loads', async () => {
    render(<Risk />)
    await waitFor(() => {
      expect(screen.getByText('Total Exposure')).toBeInTheDocument()
      expect(screen.getByText('Daily Loss')).toBeInTheDocument()
    })
  })

  it('renders severity filter dropdown', () => {
    render(<Risk />)
    expect(screen.getByDisplayValue('All Severities')).toBeInTheDocument()
  })

  it('renders event type filter dropdown', () => {
    render(<Risk />)
    expect(screen.getByDisplayValue('All Types')).toBeInTheDocument()
  })

  it('shows risk events after data loads', async () => {
    render(<Risk />)
    await waitFor(() => {
      expect(screen.getByText('Daily drawdown approaching limit')).toBeInTheDocument()
    })
  })

  it('shows active limits section after config loads', async () => {
    render(<Risk />)
    await waitFor(() => {
      expect(screen.getByText('Active Limits')).toBeInTheDocument()
    })
  })
})
