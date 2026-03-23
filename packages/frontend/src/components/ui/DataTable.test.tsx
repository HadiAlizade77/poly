import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from './DataTable'

interface Row { id: string; name: string; value: number }

const columns: ColumnDef<Row, unknown>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'value', accessorKey: 'value', header: 'Value' },
]

const rows: Row[] = [
  { id: '1', name: 'Alpha', value: 10 },
  { id: '2', name: 'Beta', value: 20 },
]

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={rows} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Value')).toBeInTheDocument()
  })

  it('renders data rows', () => {
    render(<DataTable columns={columns} data={rows} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
  })

  it('shows empty message when data is empty', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('shows default empty message when data is empty', () => {
    render(<DataTable columns={columns} data={[]} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('shows loading skeletons when loading=true', () => {
    const { container } = render(<DataTable columns={columns} data={[]} loading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    // Does not render actual data or empty message
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
  })

  it('calls onRowClick with the row when a row is clicked', () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} data={rows} onRowClick={onRowClick} getRowId={(r) => r.id} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(onRowClick).toHaveBeenCalledOnce()
    expect(onRowClick.mock.calls[0][0].original).toEqual(rows[0])
  })

  it('shows pagination when rows exceed pageSize', () => {
    const manyRows = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      name: `Item ${i}`,
      value: i,
    }))
    render(<DataTable columns={columns} data={manyRows} pageSize={5} getRowId={(r) => r.id} />)
    // Pagination navigation buttons should appear
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument()
  })

  it('does not show pagination when rows fit on one page', () => {
    render(<DataTable columns={columns} data={rows} pageSize={10} getRowId={(r) => r.id} />)
    expect(screen.queryByText(/\//)).not.toBeInTheDocument()
  })
})
