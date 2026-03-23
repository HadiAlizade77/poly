import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Balance" value="$1,000.00" />)
    expect(screen.getByText('Total Balance')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
  })

  it('renders subValue when provided', () => {
    render(<StatCard label="Win Rate" value="60%" subValue="40 wins" />)
    expect(screen.getByText('40 wins')).toBeInTheDocument()
  })

  it('shows loading skeleton when loading=true', () => {
    const { container } = render(<StatCard label="P&L" value="$100" loading />)
    // Skeleton divs have animate-pulse class
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    // Value should not be visible while loading
    expect(screen.queryByText('$100')).not.toBeInTheDocument()
  })

  it('shows value when loading=false', () => {
    render(<StatCard label="P&L" value="$100" loading={false} />)
    expect(screen.getByText('$100')).toBeInTheDocument()
  })

  it('renders ReactNode value', () => {
    render(<StatCard label="Positions" value={<span data-testid="node-val">42</span>} />)
    expect(screen.getByTestId('node-val')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<StatCard label="X" value="Y" className="border-red-500" />)
    expect(container.firstChild).toHaveClass('border-red-500')
  })
})
