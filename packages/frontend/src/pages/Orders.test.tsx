import { describe, it, expect } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Orders from './Orders'

describe('Orders', () => {
  it('renders page title', () => {
    render(<Orders />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
  })

  it('renders status filter dropdown', () => {
    render(<Orders />)
    expect(screen.getByDisplayValue('All Status')).toBeInTheDocument()
  })

  it('renders side filter dropdown', () => {
    render(<Orders />)
    expect(screen.getByDisplayValue('All Sides')).toBeInTheDocument()
  })

  it('shows order rows after data loads', async () => {
    render(<Orders />)
    await waitFor(() => {
      expect(screen.getByText('YES-BTC-001')).toBeInTheDocument()
    })
  })

  it('shows status pill for partial orders', async () => {
    render(<Orders />)
    await waitFor(() => {
      // The "partial" status badge should appear
      expect(screen.getAllByText(/partial/i).length).toBeGreaterThan(0)
    })
  })

  it('opens order drawer when a row is clicked', async () => {
    render(<Orders />)
    await waitFor(() => {
      expect(screen.getByText('YES-BTC-001')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('YES-BTC-001'))
    await waitFor(() => {
      expect(screen.getByText('Order Detail')).toBeInTheDocument()
    })
  })
})
