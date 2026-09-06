import { useState, useRef } from 'react';
import { Box, Text, render, useInput } from 'ink';
import { terminalText } from './output';
export type TerminalState = {
  title: string;
  subtitle: string;
  status: string;
  lines: string[];
  busy: boolean;
};
export function terminal(
  initial: TerminalState,
  onSubmit: (text: string) => void,
  onInterrupt: () => void,
  onDetach: () => void,
) {
  let update: (next: TerminalState) => void = () => {};
  function View() {
    const [state, setState] = useState(initial),
      [input, setInput] = useState(''),
      inputRef = useRef('');
    update = setState;
    const change = (value: string) => {
      inputRef.current = value;
      setInput(value);
    };
    useInput((value, key) => {
      if (key.ctrl && value === 'c') {
        onInterrupt();
        return;
      }
      if (key.ctrl && value === 'd' && !inputRef.current) {
        onDetach();
        return;
      }
      if (key.return) {
        const text = inputRef.current.trim();
        change('');
        if (text) onSubmit(text);
        return;
      }
      if (key.backspace || key.delete) {
        change(Array.from(inputRef.current).slice(0, -1).join(''));
        return;
      }
      if (key.ctrl && value === 'u') {
        change('');
        return;
      }
      if (
        !key.ctrl &&
        !key.meta &&
        !key.escape &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow
      )
        change((inputRef.current + terminalText(value)).slice(0, 100000));
    });
    const rows = Math.max(4, (process.stdout.rows || 28) - 10);
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
          <Text bold color="cyan">
            {terminalText(state.title)}
          </Text>
          <Text dimColor>{terminalText(state.subtitle)}</Text>
        </Box>
        <Box flexDirection="column" minHeight={4} marginY={1}>
          {state.lines
            .flatMap((line) => terminalText(line).split('\n'))
            .slice(-rows)
            .map((line, i) => (
              <Text key={i} wrap="wrap">
                {line || ' '}
              </Text>
            ))}
        </Box>
        <Text color={state.busy ? 'yellow' : 'green'}>{terminalText(state.status)}</Text>
        <Box marginTop={1}>
          <Text color="cyan" bold>
            ›{' '}
          </Text>
          <Text>{input || 'Ask the hosted agent…'}</Text>
          <Text inverse> </Text>
        </Box>
        <Text dimColor>/help · /detach leaves work running · Ctrl-C cancels · Ctrl-D detaches</Text>
      </Box>
    );
  }
  const view = render(<View />, { exitOnCtrlC: false, patchConsole: false });
  return {
    update: (state: TerminalState) => update({ ...state, lines: [...state.lines] }),
    close: () => view.unmount(),
  };
}
