/**
 * Generate the sample PDF used as a test fixture and as the repo's demo document.
 *
 * Written by hand rather than pulled from a library so the fixture is deterministic and the
 * repo carries no extra dependency. Each page contains distinct, checkable facts, which lets
 * the ingest test assert that a fact lands on the page it was written to — the actual
 * guarantee behind every page citation.
 *
 * Run:  node scripts/make-sample-pdf.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'fixtures/acme-handbook.pdf';

/** Page content. Facts are deliberately specific so a wrong-page citation is obvious. */
const PAGES = [
  [
    'ACME CORP CUSTOMER HANDBOOK',
    '',
    'Revision 7, published March 2026.',
    '',
    'This handbook describes billing, support and onboarding',
    'policies for all Acme Corp customer tiers. It supersedes',
    'all previous revisions.',
    '',
    'Questions about this document should be directed to the',
    'Customer Operations team.',
  ],
  [
    'SECTION 1: REFUNDS AND BILLING',
    '',
    'Standard customers may request a refund within 14 days',
    'of purchase. Refunds are issued to the original payment',
    'method and take 5 to 7 business days to appear.',
    '',
    'Enterprise customers may request a full refund within 45',
    'days of the invoice date. Enterprise refunds require',
    'written approval from an account director.',
    '',
    'Partial refunds are not offered for annual plans.',
  ],
  [
    'SECTION 2: SUPPORT COMMITMENTS',
    '',
    'Standard customers receive email support with a response',
    'target of one business day.',
    '',
    'Enterprise customers receive priority support with a',
    '2-hour response SLA during business hours, and a 4-hour',
    'response SLA outside them.',
    '',
    'The support portal is available at all times except',
    'during scheduled maintenance windows.',
  ],
  [
    'SECTION 3: ONBOARDING',
    '',
    'The onboarding process for enterprise accounts takes',
    'approximately three weeks from contract signature.',
    '',
    'Onboarding includes data migration, single sign-on',
    'configuration, and two training sessions for up to',
    'twenty five named users.',
    '',
    'Standard accounts are self-serve and activate instantly.',
  ],
  [
    'APPENDIX A: ERROR CODES',
    '',
    'ERR_2043 indicates that the uploaded file exceeded the',
    'maximum permitted size. Reduce the file size and retry.',
    '',
    'ERR_3011 indicates an expired authentication token.',
    'Sign out and sign back in to obtain a new token.',
    '',
    'ERR_5502 indicates a temporary upstream outage. These',
    'resolve without customer action, usually within minutes.',
  ],
];

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function contentStream(lines) {
  const body = lines
    .map((line, i) =>
      i === 0 ? `(${escape(line)}) Tj` : `T* (${escape(line)}) Tj`,
    )
    .join('\n');
  return `BT\n/F1 11 Tf\n16 TL\n72 720 Td\n${body}\nET\n`;
}

// Object 1 = Catalog, 2 = Pages, 3 = Font, then per page: Page object + Contents object.
const objects = [];
const pageObjectNumbers = [];
let nextObject = 4;

for (const lines of PAGES) {
  const pageNumber = nextObject++;
  const contentNumber = nextObject++;
  pageObjectNumbers.push(pageNumber);

  const stream = contentStream(lines);
  objects.push({
    number: pageNumber,
    body:
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
  });
  objects.push({
    number: contentNumber,
    body: `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
  });
}

objects.unshift(
  { number: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
  {
    number: 2,
    body: `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${PAGES.length} >>`,
  },
  { number: 3, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
);

objects.sort((a, b) => a.number - b.number);

// Assemble, recording byte offsets for the xref table.
let pdf = '%PDF-1.4\n';
const offsets = new Map();

for (const object of objects) {
  offsets.set(object.number, Buffer.byteLength(pdf, 'latin1'));
  pdf += `${object.number} 0 obj\n${object.body}\nendobj\n`;
}

const xrefOffset = Buffer.byteLength(pdf, 'latin1');
const total = objects.length + 1;

pdf += `xref\n0 ${total}\n0000000000 65535 f \n`;
for (let n = 1; n < total; n++) {
  pdf += `${String(offsets.get(n) ?? 0).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(pdf, 'latin1'));

console.log(`Wrote ${OUT}`);
console.log(`  ${PAGES.length} pages, ${Buffer.byteLength(pdf, 'latin1')} bytes`);
console.log('\nExpected page attribution:');
console.log('  p.2  refund, 45 days, enterprise');
console.log('  p.3  2-hour response SLA');
console.log('  p.4  three weeks onboarding');
console.log('  p.5  ERR_2043 (exact-token retrieval test)');
