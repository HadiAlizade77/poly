import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Hello</Badge>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('applies default variant classes', () => {
    render(<Badge>default</Badge>)
    const el = screen.getByText('default')
    expect(el).toHaveClass('bg-slate-700', 'text-slate-200')
  })

  it('applies success variant classes', () => {
    render(<Badge variant="success">Win</Badge>)
    const el = screen.getByText('Win')
    expect(el).toHaveClass('text-profit')
  })

  it('applies danger variant classes', () => {
    render(<Badge variant="danger">Loss</Badge>)
    const el = screen.getByText('Loss')
    expect(el).toHaveClass('text-loss')
  })

  it('applies warning variant classes', () => {
    render(<Badge variant="warning">Warn</Badge>)
    const el = screen.getByText('Warn')
    expect(el).toHaveClass('text-warning')
  })

  it('applies info variant classes', () => {
    render(<Badge variant="info">Info</Badge>)
    const el = screen.getByText('Info')
    expect(el).toHaveClass('text-info')
  })

  it('applies outline variant classes', () => {
    render(<Badge variant="outline">Outline</Badge>)
    const el = screen.getByText('Outline')
    expect(el).toHaveClass('border', 'text-muted-foreground')
  })

  it('renders as a span element', () => {
    render(<Badge>Tag</Badge>)
    expect(screen.getByText('Tag').tagName).toBe('SPAN')
  })

  it('merges custom className', () => {
    render(<Badge className="my-custom">Custom</Badge>)
    expect(screen.getByText('Custom')).toHaveClass('my-custom')
  })
})
