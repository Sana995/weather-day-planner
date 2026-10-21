import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal()), streamLlm: vi.fn() }));

import ChatPanel from '../components/ChatPanel.jsx';
import { streamLlm } from '../api.js';

const CONTEXT = {
  city: 'Zagreb', date: '2026-08-08',
  profile: { activity: 'hiking', coldTolerance: 'average', heatTolerance: 'sensitive to heat' },
  traveling: false,
};

describe('ChatPanel', () => {
  // Braced body: a concise arrow returns the spy and Vitest would call it as a cleanup hook.
  beforeEach(() => { streamLlm.mockReset(); });

  it('sends the seed as the first assistant turn plus the typed message', async () => {
    streamLlm.mockImplementation(async (path, body, { onToken }) => onToken('Kalnik works too.'));
    render(<ChatPanel context={CONTEXT} seed="Try Sljeme." />);
    await userEvent.type(screen.getByLabelText(/your message/i), '1.5h driving is also okay');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(streamLlm).toHaveBeenCalledWith('/api/chat', {
      context: CONTEXT,
      messages: [
        { role: 'assistant', content: 'Try Sljeme.' },
        { role: 'user', content: '1.5h driving is also okay' },
      ],
    }, expect.any(Object));
    expect(await screen.findByText('Kalnik works too.')).toBeInTheDocument();
    expect(screen.getByText('1.5h driving is also okay')).toBeInTheDocument();
  });

  it('shows the tool label while a tool runs', async () => {
    // onTool fires from the (mocked) stream, outside React's event system, so
    // its state update needs act(); finish resolves the stream inside the test
    // rather than on a timer, so the busy-state teardown is flushed here too.
    let sendTool;
    let finish;
    streamLlm.mockImplementation((path, body, { onTool }) => new Promise((resolve) => {
      sendTool = () => onTool({ name: 'get_weather', label: 'Checking the forecast for Žumberak…' });
      finish = resolve;
    }));
    render(<ChatPanel context={CONTEXT} seed="Try Sljeme." />);
    await userEvent.type(screen.getByLabelText(/your message/i), 'further is fine');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    act(() => sendTool());
    expect(await screen.findByText(/Checking the forecast for Žumberak/)).toBeInTheDocument();
    await act(async () => finish());
  });

  it('surfaces stream errors', async () => {
    streamLlm.mockImplementation(async (path, body, { onError }) => onError(new Error('The AI stream failed — please try again.')));
    render(<ChatPanel context={CONTEXT} seed="Try Sljeme." />);
    await userEvent.type(screen.getByLabelText(/your message/i), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/AI stream failed/);
  });

  it('keeps history across turns', async () => {
    streamLlm.mockImplementation(async (path, body, { onToken }) => onToken(`reply ${body.messages.length}`));
    render(<ChatPanel context={CONTEXT} seed="Try Sljeme." />);
    const input = screen.getByLabelText(/your message/i);
    await userEvent.type(input, 'first');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('reply 2');
    await userEvent.type(input, 'second');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    // seed + first + reply + second = 4 messages sent the second time
    expect(await screen.findByText('reply 4')).toBeInTheDocument();
  });
});
