import type { RawCase } from '../types.js';

export interface RiigikohusAdapter {
  fetch(keywords: string[], since?: string): Promise<RawCase[]>;
}

export class StubRiigikohusAdapter implements RiigikohusAdapter {
  constructor(private fixtures: RawCase[] = []) {}
  async fetch(_keywords: string[], _since?: string): Promise<RawCase[]> {
    return this.fixtures;
  }
}
