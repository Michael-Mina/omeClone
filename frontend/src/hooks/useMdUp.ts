import { useEffect, useState } from 'react';

const MD_UP_MQ = '(min-width: 768px)';

/** `true` cuando el viewport es ≥768px (breakpoint `md` de Tailwind). */
export function useMdUp() {
  const [mdUp, setMdUp] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MD_UP_MQ).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(MD_UP_MQ);
    const onChange = () => setMdUp(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mdUp;
}
