export type Topic =
  | 'koostamine'
  | 'kutse'
  | 'materjalid'
  | 'haaletamine'
  | 'kvoorum'
  | 'protokoll'
  | 'kinnitamine'
  | 'vaidlustamine'
  | 'kulude_jaotus';

export type Era = 'KOS' | 'KYS' | 'KrtS';

export interface Citation {
  caseNumber: string;
  points: string;
}

export interface RawCase {
  caseNumber: string;
  date: string;
  keyword: string;
  text: string;
  era?: Era;
  citations?: Citation[];
  proposedBullet?: string;
}

export interface Candidate {
  id: string;
  caseNumber: string;
  date: string;
  keyword: string;
  topic: Topic;
  candidateBullet: string;
  citations: Citation[];
  status: 'pending' | 'rejected';
  createdAt: string;
}

export interface ApprovedRule {
  id: string;
  bullet: string;
  topic: Topic;
  citations: Citation[];
  sourceKeywords: string[];
  approvedAt: string;
}
