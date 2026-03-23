import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Positions from './Positions'

describe('Positions', () => {
  it('renders page title', () => {
    render(<Positions />)
    expect(screen.getByText('Positions')).toBeInTheDocument()
  })

  it('renders Open and History tab buttons', () => {
    render(<Positions />)
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('renders open positions stat cards', () => {
    render(<Positions />)
    expect(screen.getByText('Unrealized P&L')).toBeInTheDocument()
    expect(screen.getByText('Realized P&L')).toBeInTheDocument()
    expect(screen.getByText('Total Fees')).toBeInTheDocument()
    expect(screen.getByText('Long / Short')).toBeInTheDocument()
  })

  it('shows open position token after data loads', async () => {
    render(<Positions />)
    await waitFor(() => {
      expect(screen.getByText('YES-BTC-001')).toBeInTheDocument()
    })
  })

  it('shows close button for each open position', async () => {
    render(<Positions />)
    await waitFor(() => {
      expect(screen.getByText('YES-BTC-001')).toBeInTheDocument()
    })
    expect(screen.getByText('Close')).toBeInTheDocument()
  })

  it('switches to History tab', async () => {
    render(<Positions />)
    fireEvent.click(screen.getByText('History'))
    await waitFor(() => {
      expect(screen.getByText('Closed Positions')).toBeInTheDocument()
    })
  })

  it('shows position history after switching tab', async () => {
    render(<Positions />)
    fireEvent.click(screen.getByText('History'))
    await waitFor(() => {
      expect(screen.getByText('YES-ETH-001')).toBeInTheDocument()
    })
  })
})
