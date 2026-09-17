export interface LogEntry {
  id: string;
  time: number;
  message: string;
  channel?: 'player' | 'debug';
}