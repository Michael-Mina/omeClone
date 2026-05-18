import { useEffect, useState } from 'react';

/** Misma condición que el variant `md` de Tailwind (ver index.css). */
export const MD_UP_MQ = '(min-width: 768px) and (hover: hover) and (pointer: fine)';

/** `true` solo en viewport ancho con puntero fino (PC), no en móvil en horizontal. */
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
