import { io } from 'socket.io-client';
import { getSocketOrigin } from '../config/apiBase';

export const socket = io(getSocketOrigin(), {
  autoConnect: false,
  /** WebSocket primero evita el RTT extra del long-polling + upgrade (matchmaking más rápido). */
  transports: ['websocket', 'polling'],
});
