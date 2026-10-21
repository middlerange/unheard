// ABOUTME: Animated braille character spinner for lightweight loading indicators.
// ABOUTME: Cycles through braille dot patterns at 80ms intervals.

import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL = 80;

interface Props {
  className?: string;
}

export function BrailleSpinner({ className }: Props) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((i) => (i + 1) % FRAMES.length);
    }, INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return <span className={className}>{FRAMES[frameIndex]}</span>;
}
