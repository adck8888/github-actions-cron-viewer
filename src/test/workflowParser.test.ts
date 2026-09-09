import * as assert from 'assert';
import { findSchedules, isWorkflowPath } from '../workflowParser';

describe('findSchedules', () => {
  it('finds a single cron schedule', () => {
    const text = ['name: Nightly', 'on:', '  schedule:', "    - cron: '0 4 * * 1-5'", ''].join('\n');
    const schedules = findSchedules(text);

    assert.strictEqual(schedules.length, 1);
    assert.strictEqual(schedules[0].expression, '0 4 * * 1-5');
    assert.strictEqual(schedules[0].timezone, undefined);
    assert.strictEqual(text.slice(schedules[0].range.start, schedules[0].range.end), "'0 4 * * 1-5'");
  });

  it('finds several schedules in one workflow', () => {
    const text = [
      'on:',
      '  schedule:',
      "    - cron: '0 4 * * 1-5'",
      "    - cron: '30 2 * * 0'",
      "    - cron: '*/10 * * * *'",
      ''
    ].join('\n');

    assert.deepStrictEqual(
      findSchedules(text).map((schedule) => schedule.expression),
      ['0 4 * * 1-5', '30 2 * * 0', '*/10 * * * *']
    );
  });

  it('reads the timezone declared next to a cron entry', () => {
    const text = [
      'on:',
      '  schedule:',
      "    - cron: '0 4 * * 1-5'",
      "      timezone: 'Asia/Yerevan'",
      "    - cron: '0 9 * * *'",
      ''
    ].join('\n');
    const schedules = findSchedules(text);

    assert.strictEqual(schedules[0].timezone, 'Asia/Yerevan');
    assert.strictEqual(schedules[1].timezone, undefined);
  });

  it('keeps invalid cron values so they can be reported', () => {
    const text = ['on:', '  schedule:', "    - cron: 'not a cron'", ''].join('\n');

    assert.deepStrictEqual(
      findSchedules(text).map((schedule) => schedule.expression),
      ['not a cron']
    );
  });

  it('returns nothing for a workflow without a schedule', () => {
    const text = [
      'name: CI',
      'on:',
      '  push:',
      '    branches: [main]',
      '  pull_request:',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      ''
    ].join('\n');

    assert.deepStrictEqual(findSchedules(text), []);
  });

  it('returns nothing for shorthand and unusual trigger shapes', () => {
    assert.deepStrictEqual(findSchedules('on: push\n'), []);
    assert.deepStrictEqual(findSchedules('on: [push, pull_request]\n'), []);
    assert.deepStrictEqual(findSchedules('on:\n  schedule: nope\n'), []);
    assert.deepStrictEqual(findSchedules('on:\n  schedule:\n    - notcron: 1\n'), []);
  });

  it('survives broken YAML and empty input', () => {
    assert.deepStrictEqual(findSchedules(''), []);
    assert.deepStrictEqual(findSchedules('   \n\t: : :\n  - [\n'), []);
  });
});

describe('isWorkflowPath', () => {
  it('accepts workflow files on both path separators', () => {
    assert.ok(isWorkflowPath('/repo/.github/workflows/nightly.yml'));
    assert.ok(isWorkflowPath('C:\\repo\\.github\\workflows\\nightly.yaml'));
  });

  it('rejects anything outside .github/workflows', () => {
    assert.ok(!isWorkflowPath('/repo/docker-compose.yml'));
    assert.ok(!isWorkflowPath('/repo/.github/dependabot.yml'));
    assert.ok(!isWorkflowPath('/repo/.github/workflows/README.md'));
  });
});
