import { isMap, isScalar, isSeq, parseDocument, Node, Scalar, YAMLMap } from 'yaml';

export interface SourceRange {
  /** Character offset of the first character of the value. */
  start: number;
  /** Character offset just past the last character of the value. */
  end: number;
}

export interface WorkflowSchedule {
  /** The cron expression exactly as written in the file. */
  expression: string;
  /** Timezone declared next to the cron entry, if any. */
  timezone?: string;
  /** Position of the cron value in the document. */
  range: SourceRange;
  /** Position of the whole `- cron: ...` list item, used to anchor the CodeLens. */
  itemRange: SourceRange;
}

/** True for `.github/workflows/*.yml|yaml`, which is where GitHub Actions looks for workflows. */
export function isWorkflowPath(filePath: string): boolean {
  return /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/i.test(filePath);
}

function rangeOf(node: Node): SourceRange {
  const range = node.range;
  return { start: range?.[0] ?? 0, end: range?.[1] ?? 0 };
}

function stringValue(node: unknown): string | undefined {
  if (isScalar(node) && typeof (node as Scalar).value === 'string') {
    return (node as Scalar).value as string;
  }
  if (isScalar(node) && typeof (node as Scalar).value === 'number') {
    return String((node as Scalar).value);
  }
  return undefined;
}

/**
 * Finds the `on.schedule` node. YAML 1.2 keeps `on` as a string, but some files
 * are written for YAML 1.1 parsers where `on` becomes the boolean `true`, so we
 * accept both spellings.
 */
function findScheduleNode(root: unknown): unknown {
  if (!isMap(root)) {
    return undefined;
  }
  const map = root as YAMLMap;
  const triggers = map.get('on', true) ?? map.get(true as unknown as string, true);
  if (!isMap(triggers)) {
    return undefined;
  }
  return (triggers as YAMLMap).get('schedule', true);
}

/**
 * Extracts every cron schedule from a GitHub Actions workflow document.
 * Malformed YAML, missing triggers or a workflow without `schedule` all
 * return an empty list rather than throwing.
 */
export function findSchedules(text: string): WorkflowSchedule[] {
  let schedule: unknown;
  try {
    schedule = findScheduleNode(parseDocument(text, { keepSourceTokens: false }).contents);
  } catch {
    return [];
  }

  if (!isSeq(schedule)) {
    return [];
  }

  const schedules: WorkflowSchedule[] = [];
  for (const item of schedule.items) {
    if (!isMap(item)) {
      continue;
    }
    const cronNode = (item as YAMLMap).get('cron', true);
    const expression = stringValue(cronNode);
    if (expression === undefined) {
      continue;
    }
    schedules.push({
      expression,
      timezone: stringValue((item as YAMLMap).get('timezone', true)),
      range: rangeOf(cronNode as Node),
      itemRange: rangeOf(item as Node)
    });
  }
  return schedules;
}
