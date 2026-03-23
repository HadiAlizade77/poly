import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PnlDisplay } from './PnlDisplay'

describe('PnlDisplay', () => {
  it('renders positive value with + sign and profit color', () => {
    render(<PnlDisplay value={10.5} />)
    const el = screen.getByText('+$10.50')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('text-profit')
  })

  it('renders negative value with - sign and loss color', () => {
    render(<PnlDisplay value={-5.25} />)
    const el = screen.getByText('-$5.25')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('text-loss')
  })

  it('renders zero value with muted color', () => {
    render(<PnlDisplay value={0} />)
    const el = screen.getByText('$0.00')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('text-muted-foreground')
  })

  it('shows icon when showIcon=true', () => {
    const { container } = render(<PnlDisplay value={10} showIcon />)
    // lucide icons render as SVG
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('does not show icon when showIcon=false (default)', () => {
    const { container } = render(<PnlDisplay value={10} />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('applies lg size class', () => {
    render(<PnlDisplay value={50} size="lg" />)
    const el = screen.getByText('+$50.00')
    expect(el).toHaveClass('text-2xl', 'font-semibold')
  })

  it('applies sm size class', () => {
    render(<PnlDisplay value={50} size="sm" />)
    const el = screen.getByText('+$50.00')
    expect(el).toHaveClass('text-sm')
  })

  it('formats large numbers with commas', () => {
    render(<PnlDisplay value={1234567.89} />)
    expect(screen.getByText('+$1,234,567.89')).toBeInTheDocument()
  })

  it('uses custom prefix', () => {
    render(<PnlDisplay value={5} prefix="€" />)
    expect(screen.getByText('+€5.00')).toBeInTheDocument()
  })
})
