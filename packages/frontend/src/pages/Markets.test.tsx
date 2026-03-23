import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Markets from './Markets'

describe('Markets', () => {
  it('renders without crashing', () => {
    render(<Markets />)
  })

  it('renders category filter tabs', () => {
    render(<Markets />)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Crypto')).toBeInTheDocument()
    expect(screen.getByText('Politics')).toBeInTheDocument()
  })

  it('renders search input', () => {
    render(<Markets />)
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('shows market title after data loads', async () => {
    render(<Markets />)
    await waitFor(() => {
      expect(screen.getByText('Will BTC exceed $100k?')).toBeInTheDocument()
    })
  })

  it('shows market status filter', () => {
    render(<Markets />)
    // Status filter is a select element
    expect(screen.getByDisplayValue('All Status')).toBeInTheDocument()
  })
})
