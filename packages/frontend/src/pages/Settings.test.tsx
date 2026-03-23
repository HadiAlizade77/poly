import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import Settings from './Settings'

describe('Settings', () => {
  it('renders page title', () => {
    render(<Settings />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders Kill Switch section', () => {
    render(<Settings />)
    expect(screen.getByText('Kill Switch')).toBeInTheDocument()
  })

  it('renders Risk Configuration section', () => {
    render(<Settings />)
    expect(screen.getByText('Risk Configuration')).toBeInTheDocument()
  })

  it('renders System Configuration section', () => {
    render(<Settings />)
    expect(screen.getByText('System Configuration')).toBeInTheDocument()
  })

  it('shows Enable Kill Switch button', () => {
    render(<Settings />)
    expect(screen.getByText('Enable Kill Switch')).toBeInTheDocument()
  })

  it('shows risk config fields after data loads', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Max Daily Loss')).toBeInTheDocument()
    })
  })

  it('shows system config keys after data loads', async () => {
    render(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('trading_enabled')).toBeInTheDocument()
    })
  })
})
