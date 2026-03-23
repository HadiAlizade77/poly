import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders navigation links', () => {
    render(<Sidebar />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /markets/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /positions/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /risk/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders the collapse/expand toggle button', () => {
    render(<Sidebar />);
    const toggle = screen.getByRole('button', {
      name: /collapse sidebar|expand sidebar/i,
    });
    expect(toggle).toBeInTheDocument();
  });

  it('toggles sidebar open/closed when button is clicked', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // Initial state: sidebar is open (default), button says "Collapse sidebar"
    const toggleBtn = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(toggleBtn).toBeInTheDocument();

    await user.click(toggleBtn);

    // After click: sidebar collapsed, button says "Expand sidebar"
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument();
  });
});
