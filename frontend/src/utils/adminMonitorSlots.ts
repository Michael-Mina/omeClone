import type { DashboardUser } from '../types/adminDashboard';

export const MONITOR_WALL_SLOT_COUNT = 16;
export const MONITOR_WALL_STORAGE_KEY = 'admin_monitor_wall_v1';
export const MONITOR_WALL_AUDIO_KEY = 'admin_monitor_wall_audio_v1';

/** Identificador estable: cuenta registrada o fila de dashboard. */
export type SlotBinding = string | null;

export function bindingFromUser(user: DashboardUser): SlotBinding {
  if (user.db_user_id != null) return `db:${user.db_user_id}`;
  return `row:${user.row_key}`;
}

export function resolveUserByBinding(
  users: DashboardUser[],
  binding: SlotBinding
): DashboardUser | null {
  if (!binding) return null;
  if (binding.startsWith('db:')) {
    const id = Number(binding.slice(3));
    if (!Number.isFinite(id)) return null;
    return users.find((u) => u.db_user_id === id) ?? null;
  }
  if (binding.startsWith('row:')) {
    const key = binding.slice(4);
    return users.find((u) => u.row_key === key) ?? null;
  }
  return null;
}

export function loadMonitorSlotBindings(): SlotBinding[] {
  try {
    const raw = localStorage.getItem(MONITOR_WALL_STORAGE_KEY);
    if (!raw) return Array(MONITOR_WALL_SLOT_COUNT).fill(null);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return Array(MONITOR_WALL_SLOT_COUNT).fill(null);
    const out: SlotBinding[] = [];
    for (let i = 0; i < MONITOR_WALL_SLOT_COUNT; i++) {
      const v = parsed[i];
      out.push(typeof v === 'string' && v ? v : null);
    }
    return out;
  } catch {
    return Array(MONITOR_WALL_SLOT_COUNT).fill(null);
  }
}

export function saveMonitorSlotBindings(slots: SlotBinding[]) {
  localStorage.setItem(
    MONITOR_WALL_STORAGE_KEY,
    JSON.stringify(slots.slice(0, MONITOR_WALL_SLOT_COUNT))
  );
}

export function loadMonitorAudioEnabled(): boolean[] {
  try {
    const raw = localStorage.getItem(MONITOR_WALL_AUDIO_KEY);
    if (!raw) return Array(MONITOR_WALL_SLOT_COUNT).fill(false);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return Array(MONITOR_WALL_SLOT_COUNT).fill(false);
    return Array.from({ length: MONITOR_WALL_SLOT_COUNT }, (_, i) => Boolean(parsed[i]));
  } catch {
    return Array(MONITOR_WALL_SLOT_COUNT).fill(false);
  }
}

export function saveMonitorAudioEnabled(flags: boolean[]) {
  localStorage.setItem(
    MONITOR_WALL_AUDIO_KEY,
    JSON.stringify(flags.slice(0, MONITOR_WALL_SLOT_COUNT))
  );
}

export function bindingLabel(users: DashboardUser[], binding: SlotBinding): string {
  const u = resolveUserByBinding(users, binding);
  if (!u) return binding ? 'Usuario no encontrado' : 'Vacío';
  return u.display_name || 'Usuario';
}
