const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCourseTransition } = require('../src/services/courses/course-lifecycle');

test('course lifecycle permits forward progress and cancellation from active', () => {
  for (const [from, to] of [
    ['DRAFT', 'DRAFT'], ['DRAFT', 'OPEN_FOR_NOMINATION'],
    ['OPEN_FOR_NOMINATION', 'COMPLETED'],
    ['NOMINATION_CLOSED', 'CANCELLED'],
    ['CANDIDATE_PROCESSING', 'COMPLETED'],
    ['COMPLETED', 'ARCHIVED'],
  ]) assert.doesNotThrow(() => assertCourseTransition(from, to));
});

test('course lifecycle rejects skipped, reversed and final-state transitions', () => {
  for (const [from, to] of [
    ['DRAFT', 'ARCHIVED'], ['DRAFT', 'COMPLETED'],
    ['OPEN_FOR_NOMINATION', 'ARCHIVED'],
    ['NOMINATION_CLOSED', 'OPEN_FOR_NOMINATION'],
    ['COMPLETED', 'CANCELLED'], ['COMPLETED', 'COMPLETED'],
    ['ARCHIVED', 'ACTIVE'], ['CANCELLED', 'ACTIVE'],
  ]) assert.throws(() => assertCourseTransition(from, to), /انتقال حالة الدورة/);
});
