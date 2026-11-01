import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centeringVerdict, estimateGrade, gradesToCompare, gradingOutcomes, PSA_CENTERING, QUESTIONS, type Answers } from './gradeCheck.ts';

const at = (share: number, error = 1) => ({ share, error });

test("PSA's centering limits run from strict to loose, and the leeway only for 7 and up", () => {
  for (let i = 1; i < PSA_CENTERING.length; i++) {
    assert.ok(PSA_CENTERING[i].front >= PSA_CENTERING[i - 1].front);
    assert.ok(PSA_CENTERING[i].back >= PSA_CENTERING[i - 1].back);
  }
  assert.deepEqual(
    PSA_CENTERING.filter((l) => l.leeway).map((l) => l.grade),
    [10, 9, 8, 7],
  );
  for (const l of PSA_CENTERING) if (l.leeway) assert.equal(l.leeway, l.front + 5);
});

test('centering: the best grade its front and back allow', () => {
  assert.equal(centeringVerdict(at(52), at(60))?.grade, 10);
  assert.equal(centeringVerdict(at(55.4), at(60))?.grade, 10, '55.4/44.6 is written 55/45');
  assert.equal(centeringVerdict(at(58), at(60))?.grade, 9);
  assert.equal(centeringVerdict(at(52), at(80))?.grade, 9, 'a 10 needs 75/25 or better on the back');
  assert.equal(centeringVerdict(at(72), null)?.grade, 6);
  assert.equal(centeringVerdict(at(92), null)?.grade, 1, 'past 90/10 only a 1 has no centering limit');
  assert.equal(centeringVerdict(null, null), null);
});

test("centering: PSA's front leeway, what limits it, and when it's too close to call", () => {
  const leeway = centeringVerdict(at(58), at(60))!;
  assert.equal(leeway.leeway, 10, '58/42 is within the 10’s leeway');
  assert.equal(centeringVerdict(at(63), null)?.leeway, 9);
  assert.equal(centeringVerdict(at(78), null)?.leeway, null, 'no leeway below 7');
  assert.equal(centeringVerdict(at(52), null)?.leeway, null, 'nothing to gain at a 10');
  assert.equal(centeringVerdict(at(58), at(80))?.leeway, null, 'the back holds it at 9 anyway');

  assert.equal(centeringVerdict(at(52), at(80))?.limitedBy, 'back');
  assert.equal(centeringVerdict(at(62), at(60))?.limitedBy, 'front');
  assert.equal(centeringVerdict(at(52), at(60))?.limitedBy, null);

  assert.equal(centeringVerdict(at(52, 1), null)?.close, false);
  assert.equal(centeringVerdict(at(54, 2), null)?.close, true, '54 ± 2 could be 56/44');
  assert.equal(centeringVerdict(null, at(74, 2))?.close, true);
});

const answer = (aspect: string, label: string): Answers => {
  const q = QUESTIONS.find((x) => x.aspect === aspect)!;
  return { [aspect]: q.choices.findIndex((c) => c.label === label) };
};

test('every question starts with the flawless answer, and its choices get worse', () => {
  for (const q of QUESTIONS) {
    assert.equal(q.choices[0].best, 10, q.aspect);
    for (let i = 1; i < q.choices.length; i++) assert.ok(q.choices[i].best < q.choices[i - 1].best, `${q.aspect}: ${q.choices[i].label}`);
  }
});

test('the estimate is the lowest of what centering and each answer allow', () => {
  const centering = centeringVerdict(at(58), at(60));
  assert.deepEqual(estimateGrade(centering, {}), { best: 9, limits: ['centering'], unanswered: ['corners', 'edges', 'surface', 'creases'] });
  const worn = estimateGrade(centering, { ...answer('corners', 'Slight fraying on some corners'), ...answer('surface', 'Clean and glossy, no marks') });
  assert.equal(worn.best, 7);
  assert.deepEqual(worn.limits, ['corners']);
  assert.deepEqual(worn.unanswered, ['edges', 'creases']);
  const perfect = estimateGrade(centeringVerdict(at(51), at(60)), { corners: 0, edges: 0, surface: 0, creases: 0 });
  assert.deepEqual(perfect, { best: 10, limits: [], unanswered: [] });
  const tie = estimateGrade(centering, answer('edges', 'One or two tiny white specks, seen only up close'));
  assert.deepEqual(tie.limits, ['centering', 'edges']);
  assert.equal(estimateGrade(null, answer('creases', 'A light crease')).best, 4);
});

test('what grading could make: the value at each grade, less the raw value and the cost', () => {
  assert.deepEqual(gradesToCompare(10), [10, 9, 8]);
  assert.deepEqual(gradesToCompare(1.5), [1]);
  assert.deepEqual(gradesToCompare(2), [2, 1]);
  const values: Record<number, number> = { 10: 120, 9: 40 };
  const outcomes = gradingOutcomes([10, 9, 8], 25, (g) => values[g] ?? null, 18.5);
  assert.deepEqual(outcomes, [
    { grade: 10, value: 120, gain: 76.5 },
    { grade: 9, value: 40, gain: -3.5 },
    { grade: 8, value: null, gain: null },
  ]);
  assert.equal(gradingOutcomes([10], null, () => 100, 10)[0].gain, null, 'no raw value, no gain');
  assert.equal(gradingOutcomes([10], 20, () => 100, null)[0].gain, 80, 'no cost given: before the cost');
});
