import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Decisions from './Decisions'

describe('Decisions', () => {
  it('renders page title', () => {
    render(<Decisions />)
    expect(screen.getByText('AI Decisions')).toBeInTheDocument()
  })

  it('renders stat card labels', () => {
    render(<Decisions />)
    expect(screen.getByText('Total Decisions')).toBeInTheDocument()
    expect(screen.getByText('Trade Rate')).toBeInTheDocument()
    expect(screen.getByText('Avg Confidence')).toBeInTheDocument()
    expect(screen.getByText('Veto Rate')).toBeInTheDocument()
  })

  it('renders action filter dropdown', () => {
    render(<Decisions />)
    expect(screen.getByDisplayValue('All Actions')).toBeInTheDocument()
  })

  it('shows total decisions count after stats load', async () => {
    render(<Decisions />)
    await waitFor(() => {
      // stats.total = 50 from handler
      expect(screen.getByText('50')).toBeInTheDocument()
    })
  })

  it('renders decisions in the table after data loads', async () => {
    render(<Decisions />)
    await waitFor(() => {
      // "crypto" appears in both category dropdown option and table cell — use getAllBy
      expect(screen.getAllByText('crypto').length).toBeGreaterThan(0)
    })
  })
})
