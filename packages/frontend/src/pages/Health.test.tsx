import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Health from './Health'

describe('Health', () => {
  // Health page shows a loading spinner until REST data seeds the state
  it('renders page title after data loads', async () => {
    render(<Health />)
    await waitFor(() => {
      expect(screen.getByText('System Health')).toBeInTheDocument()
    })
  })

  it('shows overall status badge after data loads', async () => {
    render(<Health />)
    await waitFor(() => {
      expect(screen.getByText(/OK|DEGRADED|ERROR/i)).toBeInTheDocument()
    })
  })

  it('shows PM2 service names after data loads', async () => {
    render(<Health />)
    await waitFor(() => {
      expect(screen.getByText('api-server')).toBeInTheDocument()
      expect(screen.getByText('market-scanner')).toBeInTheDocument()
    })
  })

  it('shows data feed names after data loads', async () => {
    render(<Health />)
    await waitFor(() => {
      expect(screen.getByText('Binance')).toBeInTheDocument()
      expect(screen.getByText('News API')).toBeInTheDocument()
    })
  })

  it('shows database infra card after data loads', async () => {
    render(<Health />)
    await waitFor(() => {
      expect(screen.getByText(/database/i)).toBeInTheDocument()
    })
  })
})
