/** Screen Orientation lock/unlock — no incluido en todos los lib.dom de TypeScript. */
type OrientableScreen = Screen & {
  orientation?: ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>;
    unlock?: () => void;
  };
};

function orientationApi(): OrientableScreen['orientation'] | undefined {
  return (screen as OrientableScreen).orientation;
}

/** Bloquea orientación horizontal en móvil tras entrar en pantalla completa (si el navegador lo permite). */
export async function tryLockScreenLandscape(): Promise<void> {
  const o = orientationApi();
  if (!o?.lock) return;
  try {
    await o.lock('landscape-primary');
  } catch {
    try {
      await o.lock('landscape');
    } catch {
      /* Safari iOS u otros: sin lock */
    }
  }
}

export function tryUnlockScreenOrientation(): void {
  try {
    orientationApi()?.unlock?.();
  } catch {
    /* noop */
  }
}
