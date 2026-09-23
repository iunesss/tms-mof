const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCandidateDecision } = require('../src/services/courses/candidate-lifecycle');

test('preliminary acceptance can start only from selected or document stages', () => {
  for (const status of ['SELECTED', 'DOCUMENTS_PENDING', 'DOCUMENTS_UNDER_REVIEW']) {
    assert.doesNotThrow(() => assertCandidateDecision(status, 'PRELIMINARILY_ACCEPTED'));
  }
  assert.throws(
    () => assertCandidateDecision('CONFIRMED', 'PRELIMINARILY_ACCEPTED'),
    /غير متاح/
  );
});

test('confirmation requires preliminary acceptance first', () => {
  assert.doesNotThrow(() => assertCandidateDecision('PRELIMINARILY_ACCEPTED', 'CONFIRMED'));
  for (const status of ['SELECTED', 'DOCUMENTS_PENDING', 'DOCUMENTS_UNDER_REVIEW', 'CONFIRMED']) {
    assert.throws(() => assertCandidateDecision(status, 'CONFIRMED'), /قبل قبوله مبدئيًا/);
  }
});
