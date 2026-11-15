import { useEffect, useRef, useState } from 'react';
import { insertedLetters } from '../manual-planner/luna-mascot.js';
import './LunaMascot.css';

/** Aligned idle and paw frames from the standalone Planner's Luna artwork. */
export default function LunaMascot({ draft, active = true }: { draft: string; active?: boolean }) {
  const previous = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const letters = insertedLetters(previous.current, draft);
    previous.current = draft;
    if (!active || !draft.trim()) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setTyping(false);
    } else if (letters && timer.current === null) {
      setTyping(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        setTyping(false);
      }, 320);
    }
  }, [draft, active]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return (
    <span className={`luna-chat-mascot${typing ? ' luna-chat-mascot-typing' : ''}`} aria-hidden="true">
      <span className="luna-chat-idle"><img src="/assets/luna/idle.png" alt="" draggable={false} width={600} height={380} /></span>
      <span className="luna-chat-bongo"><img src="/assets/luna/bongo.png" alt="" draggable={false} width={1200} height={380} /></span>
    </span>
  );
}
