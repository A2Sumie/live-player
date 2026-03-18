export interface AppConfig {
  crawlers?: Crawler[];
  cfg_crawler?: CrawlerConfig;
  processors?: Processor[];
  formatters?: Formatter[];
  forward_targets?: ForwardTarget[];
  cfg_forward_target?: ForwardTargetPlatformCommonConfig;
  forwarders?: Forwarder[];
  cfg_forwarder?: ForwarderConfig;
  connections?: ConnectionMap;
  api?: {
    port?: number;
    secret?: string;
  };
  [key: string]: unknown;
}

export interface Crawler {
  name?: string;
  group?: string;
  websites?: string[];
  origin?: string;
  paths?: string[];
  task_type?: string;
  cfg_crawler?: CrawlerConfig;
  [key: string]: unknown;
}

export interface CrawlerConfig {
  cron?: string;
  cookie_file?: string;
  interval_time?: {
    max?: number;
    min?: number;
  };
  immediate_notify?: boolean;
  user_agent?: string;
  processor?: Processor;
  processor_id?: string;
  engine?: string;
  sub_task_type?: string[];
  aggregation?: {
    cron?: string;
    prompt?: string;
    processor_id?: string;
  };
  [key: string]: unknown;
}

export interface Processor {
  id?: string;
  name?: string;
  group?: string;
  provider?: string;
  api_key?: string;
  cfg_processor?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Formatter {
  id?: string;
  name?: string;
  group?: string;
  render_type: string;
  aggregation?: boolean;
  deduplication?: boolean;
  [key: string]: unknown;
}

export interface ForwardTargetPlatformCommonConfig {
  replace_regex?: string | [string, string] | Array<[string, string]>;
  block_until?: string;
  accept_keywords?: string[];
  filter_keywords?: string[];
  block_rules?: string | Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ForwardTarget {
  platform: string;
  id?: string;
  group?: string;
  cfg_platform: Record<string, unknown> & ForwardTargetPlatformCommonConfig;
  [key: string]: unknown;
}

export interface ForwarderConfig {
  cron?: string;
  media?: Record<string, unknown>;
  render_type?: string;
  keywords?: string[];
  aggregation?: boolean;
  deduplication?: boolean;
  formatter_id?: string;
  batch_mode?: boolean;
  [key: string]: unknown;
}

export interface Forwarder {
  id?: string;
  name?: string;
  group?: string;
  websites?: string[];
  origin?: string;
  paths?: string[];
  task_type?: string;
  task_title?: string;
  cfg_task?: Record<string, unknown>;
  subscribers?: Array<string | { id: string; cfg_forward_target?: ForwardTargetPlatformCommonConfig }>;
  cfg_forwarder?: ForwarderConfig;
  cfg_forward_target?: ForwardTargetPlatformCommonConfig;
  [key: string]: unknown;
}

export interface ConnectionMap {
  'crawler-processor'?: Record<string, string>;
  'processor-formatter'?: Record<string, string[]>;
  'crawler-formatter'?: Record<string, string[]>;
  'formatter-target'?: Record<string, string[]>;
  'forwarder-target'?: Record<string, string[]>;
  [key: string]: Record<string, string | string[]> | undefined;
}

export type ConfigIssue = {
  id: string;
  level: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
};

export type ReviewItem = {
  kind: 'added' | 'removed' | 'updated' | 'warn';
  label: string;
  detail: string;
};

export type ReviewSection = {
  title: string;
  items: ReviewItem[];
};

export function cloneAppConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config ?? {})) as AppConfig;
}

export function sortUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

export function getCrawlerConnectionKey(crawler: Crawler, index: number) {
  return crawler.name?.trim() || `__crawler_${index}`;
}

export function getFormatterConnectionKey(formatter: Formatter, index: number) {
  return formatter.id?.trim() || `__formatter_${index}`;
}

export function getTargetConnectionKey(target: ForwardTarget, index: number) {
  return target.id?.trim() || `__target_${index}`;
}

export function getForwarderConnectionKey(forwarder: Forwarder, index: number) {
  return forwarder.id?.trim() || `__forwarder_${index}`;
}

export function getCrawlerRouteFormatterIds(
  config: AppConfig,
  crawler: Crawler,
  index: number
) {
  const key = getCrawlerConnectionKey(crawler, index);
  return [...(config.connections?.['crawler-formatter']?.[key] || [])];
}

export function getFormatterTargetIds(
  config: AppConfig,
  formatter: Formatter,
  index: number
) {
  const key = getFormatterConnectionKey(formatter, index);
  return [...(config.connections?.['formatter-target']?.[key] || [])];
}

export function getForwarderInlineTargetIds(forwarder: Forwarder) {
  const inlineTargets = (forwarder.subscribers || [])
    .map((subscriber) =>
      typeof subscriber === 'string' ? subscriber : subscriber.id
    )
    .filter(Boolean);
  return sortUnique(inlineTargets);
}

export function getForwarderGraphTargetIds(
  config: AppConfig,
  forwarder: Forwarder,
  index: number
) {
  const key = getForwarderConnectionKey(forwarder, index);
  return [...(config.connections?.['forwarder-target']?.[key] || [])];
}

export function getForwarderEffectiveTargetIds(
  config: AppConfig,
  forwarder: Forwarder,
  index: number
) {
  return sortUnique([
    ...getForwarderInlineTargetIds(forwarder),
    ...getForwarderGraphTargetIds(config, forwarder, index),
  ]);
}

export function resolveCrawlerRouting(
  config: AppConfig,
  crawler: Crawler,
  index: number
) {
  const formatterIds = getCrawlerRouteFormatterIds(config, crawler, index);
  const formatters = config.formatters || [];
  const targets = config.forward_targets || [];

  const formatterKeys = new Set(
    formatters.map((formatter, formatterIndex) =>
      getFormatterConnectionKey(formatter, formatterIndex)
    )
  );

  const validFormatterIds: string[] = [];
  const missingFormatterIds: string[] = [];
  const resolvedTargets = new Set<string>();
  const missingTargetIds = new Set<string>();

  formatterIds.forEach((formatterId) => {
    if (!formatterKeys.has(formatterId)) {
      missingFormatterIds.push(formatterId);
      return;
    }

    validFormatterIds.push(formatterId);
    const targetIds = config.connections?.['formatter-target']?.[formatterId] || [];
    targetIds.forEach((targetId) => {
      if (targets.some((target, targetIndex) => getTargetConnectionKey(target, targetIndex) === targetId)) {
        resolvedTargets.add(targetId);
      } else {
        missingTargetIds.add(targetId);
      }
    });
  });

  return {
    formatterIds: validFormatterIds,
    targetIds: sortUnique(Array.from(resolvedTargets)),
    missingFormatterIds: sortUnique(missingFormatterIds),
    missingTargetIds: sortUnique(Array.from(missingTargetIds)),
  };
}

export function getFormatterInboundCrawlerCount(
  config: AppConfig,
  formatterId: string
) {
  return Object.values(config.connections?.['crawler-formatter'] || {}).filter(
    (formatterIds) => formatterIds.includes(formatterId)
  ).length;
}

export function getTargetInboundCount(config: AppConfig, targetId: string) {
  const formatterInbound = Object.values(
    config.connections?.['formatter-target'] || {}
  ).filter((targetIds) => targetIds.includes(targetId)).length;

  const templateInbound = Object.values(
    config.connections?.['forwarder-target'] || {}
  ).filter((targetIds) => targetIds.includes(targetId)).length;

  const inlineInbound = (config.forwarders || []).filter((forwarder) =>
    getForwarderInlineTargetIds(forwarder).includes(targetId)
  ).length;

  return formatterInbound + templateInbound + inlineInbound;
}

export function renameConfigConnectionReferences(
  config: AppConfig,
  kind: 'crawler' | 'formatter' | 'target' | 'forwarder',
  oldKey: string,
  newKey: string
) {
  if (!config.connections || !oldKey || !newKey || oldKey === newKey) {
    return;
  }

  if (kind === 'crawler') {
    renameRecordKey(config.connections['crawler-formatter'], oldKey, newKey);
    renameRecordKey(config.connections['crawler-processor'], oldKey, newKey);
    return;
  }

  if (kind === 'formatter') {
    renameRecordKey(config.connections['formatter-target'], oldKey, newKey);
    replaceArrayRecordValue(
      config.connections['crawler-formatter'],
      oldKey,
      newKey
    );
    replaceArrayRecordValue(
      config.connections['processor-formatter'],
      oldKey,
      newKey
    );
    return;
  }

  if (kind === 'target') {
    replaceArrayRecordValue(
      config.connections['formatter-target'],
      oldKey,
      newKey
    );
    replaceArrayRecordValue(
      config.connections['forwarder-target'],
      oldKey,
      newKey
    );
    return;
  }

  renameRecordKey(config.connections['forwarder-target'], oldKey, newKey);
}

export function removeEntityConnections(
  config: AppConfig,
  kind: 'crawler' | 'formatter' | 'target' | 'forwarder',
  key: string
) {
  if (!config.connections || !key) {
    return;
  }

  if (kind === 'crawler') {
    delete config.connections['crawler-formatter']?.[key];
    delete config.connections['crawler-processor']?.[key];
    return;
  }

  if (kind === 'formatter') {
    delete config.connections['formatter-target']?.[key];
    removeValueFromArrayRecord(config.connections['crawler-formatter'], key);
    removeValueFromArrayRecord(config.connections['processor-formatter'], key);
    return;
  }

  if (kind === 'target') {
    removeValueFromArrayRecord(config.connections['formatter-target'], key);
    removeValueFromArrayRecord(config.connections['forwarder-target'], key);
    return;
  }

  delete config.connections['forwarder-target']?.[key];
}

export function analyzeConfig(config: AppConfig) {
  const issues: ConfigIssue[] = [];
  const crawlers = config.crawlers || [];
  const formatters = config.formatters || [];
  const targets = config.forward_targets || [];
  const forwarders = config.forwarders || [];

  const formatterIds = new Set(
    formatters.map((formatter, index) =>
      getFormatterConnectionKey(formatter, index)
    )
  );
  const targetIds = new Set(
    targets.map((target, index) => getTargetConnectionKey(target, index))
  );

  crawlers.forEach((crawler, index) => {
    const route = resolveCrawlerRouting(config, crawler, index);
    const label = crawler.name || `抓取器 ${index + 1}`;
    if (route.formatterIds.length === 0) {
      issues.push({
        id: `crawler-orphan-${index}`,
        level: 'warn',
        title: `${label} 未配置格式化器路由`,
        detail: '至少连接一个格式化器前，这个抓取器不会输出任何内容。',
      });
    }

    if (route.missingFormatterIds.length > 0) {
      issues.push({
        id: `crawler-missing-formatters-${index}`,
        level: 'error',
        title: `${label} 引用了不存在的格式化器`,
        detail: route.missingFormatterIds.join(', '),
      });
    }

    if (route.missingTargetIds.length > 0) {
      issues.push({
        id: `crawler-missing-targets-${index}`,
        level: 'error',
        title: `${label} 解析到了不存在的目标`,
        detail: route.missingTargetIds.join(', '),
      });
    }
  });

  formatters.forEach((formatter, index) => {
    const formatterId = getFormatterConnectionKey(formatter, index);
    const label = formatter.name || formatterId;
    const targetRoute = getFormatterTargetIds(config, formatter, index);
    const missingTargets = targetRoute.filter((targetId) => !targetIds.has(targetId));
    const inboundCrawlerCount = getFormatterInboundCrawlerCount(config, formatterId);

    if (targetRoute.length === 0) {
      issues.push({
        id: `formatter-no-target-${formatterId}`,
        level: 'warn',
        title: `${label} 没有配置目标`,
        detail: '格式化器输出目前不会到达任何投递端。',
      });
    }

    if (missingTargets.length > 0) {
      issues.push({
        id: `formatter-missing-target-${formatterId}`,
        level: 'error',
        title: `${label} 引用了不存在的目标`,
        detail: missingTargets.join(', '),
      });
    }

    if (inboundCrawlerCount === 0) {
      issues.push({
        id: `formatter-unused-${formatterId}`,
        level: 'warn',
        title: `${label} 未被任何抓取器使用`,
        detail: '它已经定义，但当前没有任何抓取器路由经过它。',
      });
    }
  });

  targets.forEach((target, index) => {
    const targetId = getTargetConnectionKey(target, index);
    if (getTargetInboundCount(config, targetId) === 0) {
      issues.push({
        id: `target-orphan-${targetId}`,
        level: 'warn',
        title: `${targetId} 没有入边路由`,
        detail: '当前没有任何格式化器或模板会解析到这个目标。',
      });
    }
  });

  forwarders.forEach((forwarder, index) => {
    const forwarderId = getForwarderConnectionKey(forwarder, index);
    const label = forwarder.name || forwarderId;
    if (getForwarderEffectiveTargetIds(config, forwarder, index).length === 0) {
      issues.push({
        id: `forwarder-orphan-${forwarderId}`,
        level: 'warn',
        title: `${label} 没有目标绑定`,
        detail: '这个模板路径虽然存在，但目前不会向任何地方发送内容。',
      });
    }
  });

  if ((config.processors || []).length > 0) {
    issues.push({
      id: 'processors-preserved',
      level: 'info',
      title: '配置中存在 processors',
      detail: '当前界面会原样保留 processor 定义，但本轮并未把它们做成一等可编辑实体。',
    });
  }

  return issues;
}

export function buildReviewSummary(
  originalConfig: AppConfig,
  newConfig: AppConfig
) {
  const sections: ReviewSection[] = [];

  const globalChanged =
    stableSerialize(sanitizeForDiff(getGlobalDefaultsSnapshot(originalConfig))) !==
    stableSerialize(sanitizeForDiff(getGlobalDefaultsSnapshot(newConfig)));
  if (globalChanged) {
    sections.push({
      title: '全局默认值',
      items: [
        {
          kind: 'updated',
          label: '全局默认值已更新',
          detail: '抓取器默认值、目标默认值、模板默认值或 API 端口发生了变化。',
        },
      ],
    });
  }

  sections.push(
    diffCollection(
      '抓取器',
      originalConfig.crawlers || [],
      newConfig.crawlers || [],
      (crawler, index) => getCrawlerConnectionKey(crawler, index),
      (crawler, index) => crawler.name || `抓取器 ${index + 1}`
    )
  );

  sections.push(
    diffCollection(
      '格式化器',
      originalConfig.formatters || [],
      newConfig.formatters || [],
      (formatter, index) => getFormatterConnectionKey(formatter, index),
      (formatter, index) => formatter.name || getFormatterConnectionKey(formatter, index)
    )
  );

  sections.push(
    diffCollection(
      '目标',
      originalConfig.forward_targets || [],
      newConfig.forward_targets || [],
      (target, index) => getTargetConnectionKey(target, index),
      (target, index) =>
        `${getTargetConnectionKey(target, index)} (${target.platform})`
    )
  );

  sections.push(
    diffCollection(
      '模板',
      originalConfig.forwarders || [],
      newConfig.forwarders || [],
      (forwarder, index) => getForwarderConnectionKey(forwarder, index),
      (forwarder, index) =>
        forwarder.name || getForwarderConnectionKey(forwarder, index)
    )
  );

  const routeItems = buildRouteReviewItems(originalConfig, newConfig);
  if (routeItems.length > 0) {
    sections.push({
      title: '路由',
      items: routeItems,
    });
  }

  const warnings = analyzeConfig(newConfig).map((issue) => ({
    kind: 'warn' as const,
    label: issue.title,
    detail: issue.detail,
  }));
  if (warnings.length > 0) {
    sections.push({
      title: '告警',
      items: warnings,
    });
  }

  return sections.filter((section) => section.items.length > 0);
}

export function getGlobalDefaultsSnapshot(config: AppConfig) {
  return {
    cfg_crawler: config.cfg_crawler || {},
    cfg_forward_target: config.cfg_forward_target || {},
    cfg_forwarder: config.cfg_forwarder || {},
    api: {
      port: config.api?.port ?? null,
      secret_configured: Boolean(config.api?.secret),
    },
  };
}

export function summarizeTarget(target: ForwardTarget, index: number) {
  const targetId = getTargetConnectionKey(target, index);
  if (target.platform === 'telegram') {
    const chatId = String(target.cfg_platform?.chat_id || '');
    return chatId ? `聊天 ${chatId}` : `${targetId}（凭据已隐藏）`;
  }

  if (target.platform === 'qq') {
    const groupId = String(target.cfg_platform?.group_id || '');
    return groupId ? `群组 ${groupId}` : `${targetId}（凭据已隐藏）`;
  }

  if (target.platform === 'bilibili') {
    const level = String(target.cfg_platform?.media_check_level || 'default');
    return `媒体校验 ${level}`;
  }

  return targetId;
}

function renameRecordKey(
  record: Record<string, string> | Record<string, string[]> | undefined,
  oldKey: string,
  newKey: string
) {
  if (!record || oldKey === newKey || !(oldKey in record)) {
    return;
  }

  const currentValue = record[oldKey];
  if (!(newKey in record)) {
    record[newKey] = currentValue;
  } else if (Array.isArray(record[newKey]) && Array.isArray(currentValue)) {
    record[newKey] = sortUnique([
      ...(record[newKey] as string[]),
      ...currentValue,
    ]);
  }

  delete record[oldKey];
}

function replaceArrayRecordValue(
  record: Record<string, string[]> | undefined,
  oldValue: string,
  newValue: string
) {
  if (!record || oldValue === newValue) {
    return;
  }

  Object.keys(record).forEach((key) => {
    if (record[key].includes(oldValue)) {
      record[key] = sortUnique(
        record[key].map((value) => (value === oldValue ? newValue : value))
      );
    }
  });
}

function removeValueFromArrayRecord(
  record: Record<string, string[]> | undefined,
  value: string
) {
  if (!record) {
    return;
  }

  Object.keys(record).forEach((key) => {
    record[key] = record[key].filter((entry) => entry !== value);
    if (record[key].length === 0) {
      delete record[key];
    }
  });
}

function diffCollection<T>(
  title: string,
  originalItems: T[],
  newItems: T[],
  keyFn: (item: T, index: number) => string,
  labelFn: (item: T, index: number) => string
) {
  const originalMap = new Map<string, { label: string; value: T }>();
  const newMap = new Map<string, { label: string; value: T }>();

  originalItems.forEach((item, index) => {
    originalMap.set(keyFn(item, index), {
      label: labelFn(item, index),
      value: item,
    });
  });

  newItems.forEach((item, index) => {
    newMap.set(keyFn(item, index), {
      label: labelFn(item, index),
      value: item,
    });
  });

  const items: ReviewItem[] = [];

  originalMap.forEach((entry, key) => {
    if (!newMap.has(key)) {
      items.push({
        kind: 'removed',
        label: entry.label,
        detail: '已删除',
      });
    }
  });

  newMap.forEach((entry, key) => {
    if (!originalMap.has(key)) {
      items.push({
        kind: 'added',
        label: entry.label,
        detail: '已新增',
      });
    }
  });

  newMap.forEach((entry, key) => {
    const originalEntry = originalMap.get(key);
    if (!originalEntry) {
      return;
    }

    if (
      stableSerialize(sanitizeForDiff(originalEntry.value)) !==
      stableSerialize(sanitizeForDiff(entry.value))
    ) {
      items.push({
        kind: 'updated',
        label: entry.label,
        detail: '已修改',
      });
    }
  });

  return { title, items };
}

function buildRouteReviewItems(
  originalConfig: AppConfig,
  newConfig: AppConfig
) {
  const items: ReviewItem[] = [];
  items.push(
    ...compareRouteMap(
      originalConfig.connections?.['crawler-formatter'] || {},
      newConfig.connections?.['crawler-formatter'] || {},
      '抓取器路由'
    )
  );
  items.push(
    ...compareRouteMap(
      originalConfig.connections?.['formatter-target'] || {},
      newConfig.connections?.['formatter-target'] || {},
      '格式化器目标'
    )
  );
  items.push(
    ...compareRouteMap(
      originalConfig.connections?.['forwarder-target'] || {},
      newConfig.connections?.['forwarder-target'] || {},
      '模板目标'
    )
  );
  return items;
}

function compareRouteMap(
  originalMap: Record<string, string[]>,
  newMap: Record<string, string[]>,
  labelPrefix: string
) {
  const keys = sortUnique([...Object.keys(originalMap), ...Object.keys(newMap)]);
  const items: ReviewItem[] = [];

  keys.forEach((key) => {
    const originalValue = stableSerialize(sortUnique(originalMap[key] || []));
    const newValue = stableSerialize(sortUnique(newMap[key] || []));
    if (originalValue !== newValue) {
      items.push({
        kind: 'updated',
        label: `${labelPrefix}: ${key}`,
        detail: `当前关联 ${(newMap[key] || []).length} 个条目`,
      });
    }
  });

  return items;
}

function sanitizeForDiff(value: unknown): unknown {
  return sanitizeSensitive(value);
}

function sanitizeSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitive(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  Object.keys(input)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      if (isSensitiveKey(key)) {
        output[key] = input[key] ? '[hidden]' : input[key];
      } else {
        output[key] = sanitizeSensitive(input[key]);
      }
    });

  return output;
}

function isSensitiveKey(key: string) {
  return /(token|secret|password|api_key|sessdata|bili_jct|cookie)/i.test(key);
}

function stableSerialize(value: unknown) {
  return JSON.stringify(value);
}
