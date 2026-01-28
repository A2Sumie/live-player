export interface AppConfig {
    crawlers?: Array<Crawler>;
    cfg_crawler?: CrawlerConfig;
    translators?: Array<Translator>; // Independent translators
    formatters?: Array<Formatter>;   // Independent formatters
    forward_targets?: Array<ForwardTarget>;
    cfg_forward_target?: ForwardTargetPlatformCommonConfig;
    forwarders?: Array<Forwarder>;
    cfg_forwarder?: ForwarderConfig;
    connections?: ConnectionMap;     // Visual connection mapping
    api?: {
        port?: number;
        secret?: string;
    };
}

export interface Crawler {
    name?: string;
    websites?: Array<string>;
    origin?: string;
    paths?: Array<string>;
    task_type?: string;
    cfg_crawler?: CrawlerConfig;
}

export interface CrawlerConfig {
    cron?: string;
    cookie_file?: string;
    interval_time?: {
        max: number;
        min: number;
    };
    immediate_notify?: boolean;
    user_agent?: string;
    translator?: Translator; // Legacy: kept for backward compatibility
    translator_id?: string;  // New: reference to independent translator
    engine?: string;
    sub_task_type?: Array<string>;
}

export interface Translator {
    id?: string;  // Unique identifier when used as independent config
    name?: string; // Display name
    provider: string; // 'Google' | 'BigModel' | 'ByteDance' | 'Deepseek' | 'Openai' | 'QwenMT' | 'None'
    api_key: string;
    cfg_translator?: {
        prompt?: string;
        base_url?: string;
        name?: string;
        model_id?: string;
    };
}

export interface Forwarder {
    id?: string;
    name?: string;
    websites?: Array<string>;
    origin?: string;
    paths?: Array<string>;
    task_type?: string;
    task_title?: string;
    cfg_task?: any;
    subscribers?: Array<string | { id: string; cfg_forward_target?: ForwardTargetPlatformCommonConfig }>;
    cfg_forwarder?: ForwarderConfig;
    cfg_forward_target?: ForwardTargetPlatformCommonConfig;
}

export interface ForwarderConfig {
    cron?: string;
    media?: any;
    render_type?: 'text' | 'img' | 'img-with-meta' | 'img-with-source' | 'img-with-source-summary' | string; // Legacy
    formatter_id?: string; // New: reference to independent formatter
}

export interface ForwardTarget {
    platform: string; // 'telegram' | 'bilibili' | 'qq' | 'none'
    id?: string;
    cfg_platform: any; // Simplified for now
}

export interface Formatter {
    id?: string;  // Auto-generated or user-defined
    name?: string;
    render_type: 'text' | 'img' | 'img-with-meta' | 'img-with-source' | 'img-with-source-summary';
}

export interface ForwardTargetPlatformCommonConfig {
    replace_regex?: string | [string, string] | Array<[string, string]>;
    block_until?: string;
    accept_keywords?: Array<string>;
    filter_keywords?: Array<string>;
    block_rules?: Array<any>;
}

export type NodeType = 'crawler' | 'translator' | 'forwarder' | 'formatter' | 'target';

export interface VisualNode {
    id: string;
    type: NodeType;
    label: string;
    data: any; // Reference to the actual config object or part of it
    x: number;
    y: number;
    width: number;
    height: number;
    parentId?: string; // For things like Translator which are nested in Crawler
}

export interface VisualConnection {
    id: string;
    source: string;
    target: string;
    type?: 'crawler-translator' | 'translator-formatter' | 'crawler-formatter' | 'formatter-target'; // For validation
}

export interface ConnectionMap {
    'crawler-translator'?: Record<string, string>;   // crawler id -> translator id
    'translator-formatter'?: Record<string, string[]>; // translator id -> formatter ids
    'crawler-formatter'?: Record<string, string[]>;  // crawler id -> formatter ids (direct)
    'formatter-target'?: Record<string, string[]>;   // formatter id -> target ids
    'forwarder-target'?: Record<string, string[]>;   // forwarder id -> target ids
}
