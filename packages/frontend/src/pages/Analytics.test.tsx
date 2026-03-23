import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Analytics from './Analytics'

describe('Analytics', () => {
  it('renders page title', () => {
    render(<Analytics />)
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })

  it('renders stat card labels', () => {
    render(<Analytics />)
    expect(screen.getByText('Total Trades')).toBeInTheDocument()
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
    expect(screen.getByText(/Total P&L/)).toBeInTheDocument()
    expect(screen.getByText('Total Balance')).toBeInTheDocument()
  })

  it('renders chart section headings', () => {
    render(<Analytics />)
    expect(screen.getByText('Portfolio Balance History')).toBeInTheDocument()
    expect(screen.getByText('Daily P&L')).toBeInTheDocument()
    expect(screen.getByText('Win Rate Over Time')).toBeInTheDocument()
    expect(screen.getByText('Trades by Category')).toBeInTheDocument()
    expect(screen.getByText('Confidence vs Estimated Edge')).toBeInTheDocument()
    expect(screen.getByText(/Confidence Calibration/)).toBeInTheDocument()
  })

  it('shows total trades count after data loads', async () => {
    render(<Analytics />)
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
    })
  })

  it('shows win rate after data loads', async () => {
    render(<Analytics />)
    await waitFor(() => {
      expect(screen.getByText('60.0%')).toBeInTheDocument()
    })
  })

  it('shows best/worst trade stats after data loads', async () => {
    render(<Analytics />)
    await waitFor(() => {
      expect(screen.getByText('Best Trade')).toBeInTheDocument()
      expect(screen.getByText('Worst Trade')).toBeInTheDocument()
    })
  })
})
