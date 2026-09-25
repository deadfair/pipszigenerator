import type { AppConfig } from '../config';

export interface GenerateRequest {
  type: 'generate';
  config: AppConfig;
  /** fontKey -> nyers TTF. A fo szal tolti le, a worker csak beagyazza. */
  fonts: Record<string, ArrayBuffer>;
  /** Mar dekodolt hatterkep (RGB8), ha van. */
  background: { rgb: ArrayBuffer; width: number; height: number; opacity: number } | null;
}

export type WorkerRequest = GenerateRequest | { type: 'cancel' };

export type WorkerResponse =
  | { type: 'progress'; done: number; total: number; elapsedMs: number }
  | { type: 'file'; blob: Blob; name: string; index: number; of: number; pages: number }
  | { type: 'done'; pages: number; files: number; bytes: number; elapsedMs: number }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
