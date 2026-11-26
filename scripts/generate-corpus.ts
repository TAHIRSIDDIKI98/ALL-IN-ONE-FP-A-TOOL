import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_CORPUS_CONFIG, DEFAULT_CORPUS_SEED, generateCorpus } from '../fixtures/corpus/generator.js';
import {
  DEFAULT_M2_CORPUS_CONFIG,
  DEFAULT_M2_CORPUS_SEED,
  generateM2Corpus,
} from '../fixtures/corpus/m2_generator.js';

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

export function writeCommittedM2Corpus(rootDir = process.cwd()): {
  readonly m2CorpusPath: string;
  readonly m2AnswerKeyPath: string;
} {
  const m2Corpus = generateM2Corpus(DEFAULT_M2_CORPUS_SEED, DEFAULT_M2_CORPUS_CONFIG);
  const m2CorpusPath = join(rootDir, 'fixtures/corpus/m2_corpus.json');
  const m2AnswerKeyPath = join(rootDir, 'fixtures/corpus/m2_answer_key.json');
  mkdirSync(dirname(m2CorpusPath), { recursive: true });
  writeFileSync(m2CorpusPath, `${JSON.stringify(m2Corpus, null, 2)}\n`, 'utf8');
  writeFileSync(
    m2AnswerKeyPath,
    `${JSON.stringify(
      {
        generatorVersion: m2Corpus.meta.generatorVersion,
        seed: m2Corpus.meta.seed,
        demoLabel: m2Corpus.meta.demoLabel,
        items: m2Corpus.answerKey,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { m2CorpusPath, m2AnswerKeyPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = writeCommittedCorpus(process.cwd());
  const outM2 = writeCommittedM2Corpus(process.cwd());
  process.stdout.write(
    `✓ Wrote ${out.corpusPath}, ${out.answerKeyPath}, ${outM2.m2CorpusPath}, and ${outM2.m2AnswerKeyPath}\n`,
  );
}
