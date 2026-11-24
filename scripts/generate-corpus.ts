import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_CORPUS_CONFIG, DEFAULT_CORPUS_SEED, generateCorpus } from '../fixtures/corpus/generator.js';

export function writeCommittedCorpus(rootDir = process.cwd()): {
  readonly corpusPath: string;
  readonly answerKeyPath: string;
} {
  const corpus = generateCorpus(DEFAULT_CORPUS_SEED, DEFAULT_CORPUS_CONFIG);
  const corpusPath = join(rootDir, 'fixtures/corpus/corpus.json');
  const answerKeyPath = join(rootDir, 'fixtures/corpus/answer_key.json');
  mkdirSync(dirname(corpusPath), { recursive: true });
  writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
  writeFileSync(
    answerKeyPath,
    `${JSON.stringify(
      {
        generatorVersion: corpus.meta.generatorVersion,
        seed: corpus.meta.seed,
        demoLabel: corpus.meta.demoLabel,
        items: corpus.answerKey,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { corpusPath, answerKeyPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = writeCommittedCorpus(process.cwd());
  process.stdout.write(`✓ Wrote ${out.corpusPath} and ${out.answerKeyPath}\n`);
}
