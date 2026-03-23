import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Scorers from './Scorers'

describe('Scorers', () => {
  it('renders without crashing', () => {
    render(<Scorers />)
  })

  it('renders category filter tabs', () => {
    render(<Scorers />)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Crypto')).toBeInTheDocument()
    expect(screen.getByText('Sports')).toBeInTheDocument()
  })

  it('shows scorer cards after data loads', async () => {
    render(<Scorers />)
    await waitFor(() => {
      expect(screen.getByText('BTC Momentum')).toBeInTheDocument()
    })
  })

  it('shows enabled badge on active scorer', async () => {
    render(<Scorers />)
    await waitFor(() => {
      expect(screen.getByText('BTC Momentum')).toBeInTheDocument()
    })
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('shows disabled badge on inactive scorer', async () => {
    render(<Scorers />)
    await waitFor(() => {
      expect(screen.getByText('News Sentiment')).toBeInTheDocument()
    })
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})
