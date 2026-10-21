import { render, screen } from '@testing-library/react';
import Recommendation from '../components/Recommendation.jsx';

describe('Recommendation', () => {
  it('renders markdown sections', () => {
    render(<Recommendation text={'### Outfit\n- Raincoat'} streaming={false} />);
    expect(screen.getByRole('heading', { name: 'Outfit' })).toBeInTheDocument();
    expect(screen.getByText('Raincoat')).toBeInTheDocument();
  });

  it('shows a cursor while streaming', () => {
    const { container } = render(<Recommendation text="Wear" streaming={true} />);
    expect(container.querySelector('.cursor')).not.toBeNull();
  });

  it('renders nothing when idle and empty', () => {
    const { container } = render(<Recommendation text="" streaming={false} />);
    expect(container.firstChild).toBeNull();
  });
});
