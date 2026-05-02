import type { RiigikohusAdapter } from './riigikohusAdapter.js';
import { StubRiigikohusAdapter } from './riigikohusAdapter.js';
import {
  RealRiigikohusAdapter,
  type RealRiigikohusAdapterOptions,
} from './RealRiigikohusAdapter.js';
import type { RawCase } from '../types.js';

export type AdapterChoice = 'stub' | 'real';

export interface SelectAdapterOptions {
  env?: Record<string, string | undefined>;
  stubFixtures?: RawCase[];
  realOptions?: RealRiigikohusAdapterOptions;
}

export const resolveChoice = (
  env: Record<string, string | undefined> = {},
): AdapterChoice => {
  const raw = (env.RIIGIKOHUS_ADAPTER ?? 'stub').toLowerCase();
  return raw === 'real' ? 'real' : 'stub';
};

export const selectAdapter = (
  opts: SelectAdapterOptions = {},
): { adapter: RiigikohusAdapter; choice: AdapterChoice } => {
  const choice = resolveChoice(opts.env ?? process.env);
  const adapter: RiigikohusAdapter =
    choice === 'real'
      ? new RealRiigikohusAdapter(opts.realOptions)
      : new StubRiigikohusAdapter(opts.stubFixtures ?? []);
  return { adapter, choice };
};
