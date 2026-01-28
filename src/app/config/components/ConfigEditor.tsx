import { useState, useEffect } from 'react';
import { VisualNode, Crawler, Translator, Forwarder, ForwardTarget, AppConfig } from '../types';

interface ConfigEditorProps {
    node: VisualNode;
    onSave: (updatedNode: VisualNode, newData: any) => void;
    onClose: () => void;
    fullConfig: AppConfig;
    availableCookies?: string[];
}

export default function ConfigEditor({ node, onSave, onClose, availableCookies = [] }: ConfigEditorProps) {
    const [formData, setFormData] = useState<any>({});
    const [jsonError, setJsonError] = useState('');
    const [importLoading, setImportLoading] = useState(false);

    useEffect(() => {
        // Initialize form data from node data
        if (node.type === 'crawler') {
            const data = node.data as Crawler;
            setFormData({
                name: data.name,
                task_type: data.task_type || 'article',
                cron: data.cfg_crawler?.cron || '',
                cookie_file: data.cfg_crawler?.cookie_file || '',
                engine: data.cfg_crawler?.engine || 'browser',
                websites: data.websites ? data.websites.join('\n') : '',
                origin: data.origin || '',
                paths: data.paths ? data.paths.join('\n') : '',
                sub_task_type: data.cfg_crawler?.sub_task_type ? data.cfg_crawler.sub_task_type.join('\n') : '',
                interval_min: data.cfg_crawler?.interval_time?.min || '',
                interval_max: data.cfg_crawler?.interval_time?.max || '',
            });
        } else if (node.type === 'translator') {
            const data = node.data as Translator;
            setFormData({
                provider: data.provider || 'Google',
                api_key: data.api_key || '',
                model_id: data.cfg_translator?.model_id || '',
                prompt: data.cfg_translator?.prompt || '',
                base_url: data.cfg_translator?.base_url || '',
            });
        } else if (node.type === 'forwarder') {
            const data = node.data as Forwarder;
            setFormData({
                name: data.name,
                task_type: data.task_type || 'article',
                cron: data.cfg_forwarder?.cron || '',
                render_type: data.cfg_forwarder?.render_type || 'text',
                websites: data.websites ? data.websites.join('\n') : '',
                origin: data.origin || '',
                paths: data.paths ? data.paths.join('\n') : '',
                task_title: data.task_title || '',
                subscribers: data.subscribers ? data.subscribers.map(s => typeof s === 'string' ? s : s.id) : [],
                accept_keywords: data.cfg_forward_target?.accept_keywords ? data.cfg_forward_target.accept_keywords.join('\n') : '',
                filter_keywords: data.cfg_forward_target?.filter_keywords ? data.cfg_forward_target.filter_keywords.join('\n') : '',
            });
        } else if (node.type === 'formatter') {
            setFormData({
                render_type: node.data.render_type || 'text',
            });
        } else if (node.type === 'target') {
            const data = node.data as ForwardTarget;
            const cfg = data.cfg_platform || {};
            setFormData({
                platform: data.platform,
                id: data.id,
                replace_regex: JSON.stringify(data.cfg_platform?.replace_regex || '', null, 2),
                block_until: data.cfg_platform?.block_until || '',
                accept_keywords: data.cfg_platform?.accept_keywords ? data.cfg_platform.accept_keywords.join('\n') : '',
                filter_keywords: data.cfg_platform?.filter_keywords ? data.cfg_platform.filter_keywords.join('\n') : '',
                tg_token: cfg.token || '',
                tg_chat_id: cfg.chat_id || '',
                qq_url: cfg.url || '',
                qq_group_id: cfg.group_id || '',
                qq_token: cfg.token || '',
                bili_sessdata: cfg.sessdata || '',
                bili_jct: cfg.bili_jct || '',
                bili_media_check: cfg.media_check_level || 'loose',
                json_config: JSON.stringify(data.cfg_platform, null, 2),
            });
        }
    }, [node]);

    const handleChange = (field: string, value: any) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
    };

    const handleImportBilibiliCookies = async (filename: string) => {
        if (!filename) return;
        setImportLoading(true);
        try {
            const res = await fetch(`/api/cookies/view/${encodeURIComponent(filename.replace('.txt', ''))}`);
            if (!res.ok) throw new Error('Failed to fetch cookie file');
            const data = await res.json() as { content: string };
            const content = data.content;

            const lines = content.split('\n');
            let sessdata = '';
            let bili_jct = '';

            for (const line of lines) {
                if (line.startsWith('#') || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 7) {
                    const name = parts[5];
                    const value = parts[6];
                    if (name === 'SESSDATA') sessdata = value.trim();
                    if (name === 'bili_jct') bili_jct = value.trim();
                }
            }

            if (sessdata && bili_jct) {
                setFormData((prev: any) => ({
                    ...prev,
                    bili_sessdata: sessdata,
                    bili_jct: bili_jct
                }));
                alert(`Successfully imported credentials from ${filename}`);
            } else {
                alert('Could not find SESSDATA or bili_jct in the selected cookie file.');
            }

        } catch (e: any) {
            alert(`Import failed: ${e.message}`);
        } finally {
            setImportLoading(false);
        }
    };

    const handleSave = () => {
        let updatedData = { ...node.data };

        const splitLines = (str: string) => str ? str.split('\n').map(s => s.trim()).filter(Boolean) : undefined;

        if (node.type === 'crawler') {
            updatedData.name = formData.name;
            updatedData.task_type = formData.task_type;
            updatedData.websites = splitLines(formData.websites);
            updatedData.origin = formData.origin;
            updatedData.paths = splitLines(formData.paths);

            if (!updatedData.cfg_crawler) updatedData.cfg_crawler = {};
            updatedData.cfg_crawler.cron = formData.cron;
            updatedData.cfg_crawler.cookie_file = formData.cookie_file;
            updatedData.cfg_crawler.engine = formData.engine;
            updatedData.cfg_crawler.sub_task_type = splitLines(formData.sub_task_type);

            if (formData.interval_min || formData.interval_max) {
                updatedData.cfg_crawler.interval_time = {
                    min: parseInt(formData.interval_min) || 0,
                    max: parseInt(formData.interval_max) || 0
                };
            }

        } else if (node.type === 'translator') {
            updatedData.provider = formData.provider;
            updatedData.api_key = formData.api_key;
            if (!updatedData.cfg_translator) updatedData.cfg_translator = {};
            updatedData.cfg_translator.model_id = formData.model_id;
            updatedData.cfg_translator.prompt = formData.prompt;
            updatedData.cfg_translator.base_url = formData.base_url;

        } else if (node.type === 'forwarder') {
            updatedData.name = formData.name;
            updatedData.task_type = formData.task_type;
            updatedData.task_title = formData.task_title;
            updatedData.websites = splitLines(formData.websites);
            updatedData.origin = formData.origin;
            updatedData.paths = splitLines(formData.paths);

            if (!updatedData.cfg_forwarder) updatedData.cfg_forwarder = {};
            updatedData.cfg_forwarder.cron = formData.cron;

            if (!updatedData.cfg_forward_target) updatedData.cfg_forward_target = {};
            updatedData.cfg_forward_target.accept_keywords = splitLines(formData.accept_keywords);
            updatedData.cfg_forward_target.filter_keywords = splitLines(formData.filter_keywords);

        } else if (node.type === 'formatter') {
            updatedData.render_type = formData.render_type;

        } else if (node.type === 'target') {
            updatedData.platform = formData.platform;
            updatedData.id = formData.id;

            const platformConfig: any = {};
            if (formData.platform === 'telegram') {
                platformConfig.token = formData.tg_token;
                platformConfig.chat_id = formData.tg_chat_id;
            } else if (formData.platform === 'qq') {
                platformConfig.url = formData.qq_url;
                platformConfig.group_id = formData.qq_group_id;
                platformConfig.token = formData.qq_token;
            } else if (formData.platform === 'bilibili') {
                platformConfig.sessdata = formData.bili_sessdata;
                platformConfig.bili_jct = formData.bili_jct;
                platformConfig.media_check_level = formData.bili_media_check;
            } else {
                try {
                    const raw = JSON.parse(formData.json_config || '{}');
                    Object.assign(platformConfig, raw);
                } catch (e) { }
            }

            try {
                if (formData.replace_regex && (formData.replace_regex.trim().startsWith('[') || formData.replace_regex.trim().startsWith('"'))) {
                    platformConfig.replace_regex = JSON.parse(formData.replace_regex);
                } else {
                    platformConfig.replace_regex = formData.replace_regex;
                }
            } catch (e) {
                platformConfig.replace_regex = formData.replace_regex;
            }
            if (formData.block_until) platformConfig.block_until = formData.block_until;

            platformConfig.accept_keywords = splitLines(formData.accept_keywords);
            platformConfig.filter_keywords = splitLines(formData.filter_keywords);

            updatedData.cfg_platform = platformConfig;
        }

        onSave(node, updatedData);
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-8">
            <div className="bg-gray-900 border border-white/20 rounded-2xl w-full max-w-2xl max-h-full overflow-y-auto shadow-2xl flex flex-col">
                <div className="p-6 border-b border-white/10 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        Config: {node.label}
                    </h2>
                    <button onClick={onClose} className="text-white/60 hover:text-white">✕</button>
                </div>

                <div className="p-6 space-y-6 flex-grow overflow-auto">
                    {/* Crawler Editor */}
                    {node.type === 'crawler' && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <FormInput label="Name" value={formData.name} onChange={(v: string) => handleChange('name', v)} />
                                <FormSelect
                                    label="Task Type"
                                    value={formData.task_type}
                                    options={['article', 'follows']}
                                    onChange={(v: string) => handleChange('task_type', v)}
                                />
                            </div>

                            <h3 className="text-sm font-bold text-blue-300 border-b border-blue-500/30 pb-1 mt-4">Target Source</h3>
                            <FormInput label="Origin (e.g. Username)" value={formData.origin} onChange={(v: string) => handleChange('origin', v)} placeholder="@username" />
                            <FormTextarea label="Paths (e.g. List ID)" value={formData.paths} onChange={(v: string) => handleChange('paths', v)} placeholder="One path per line" />
                            <FormTextarea label="Websites (Override)" value={formData.websites} onChange={(v: string) => handleChange('websites', v)} placeholder="https://..." />

                            <h3 className="text-sm font-bold text-blue-300 border-b border-blue-500/30 pb-1 mt-4">Execution</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <FormInput label="Cron Schedule" value={formData.cron} onChange={(v: string) => handleChange('cron', v)} placeholder="* * * * *" />
                                <FormSelect
                                    label="Engine"
                                    value={formData.engine}
                                    options={['browser', 'cheerio', 'axios']}
                                    onChange={(v: string) => handleChange('engine', v)}
                                />
                            </div>
                            <FormSelect
                                label="Cookie File"
                                value={formData.cookie_file}
                                options={['', ...availableCookies]}
                                onChange={(v: string) => handleChange('cookie_file', v)}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <FormInput label="Interval Min (ms)" value={formData.interval_min} onChange={(v: string) => handleChange('interval_min', v)} type="number" />
                                <FormInput label="Interval Max (ms)" value={formData.interval_max} onChange={(v: string) => handleChange('interval_max', v)} type="number" />
                            </div>
                            <FormTextarea label="Sub Task Types" value={formData.sub_task_type} onChange={(v: string) => handleChange('sub_task_type', v)} placeholder="One per line" />
                        </>
                    )}

                    {/* Translator / LLM Editor */}
                    {node.type === 'translator' && (
                        <>
                            <div className="mb-4 bg-blue-500/10 p-3 rounded border border-blue-500/30 text-xs text-blue-200">
                                This translator profile is attached to the crawler.
                            </div>
                            <FormSelect
                                label="Provider"
                                value={formData.provider}
                                options={['Google', 'BigModel', 'Deepseek', 'Openai', 'ByteDance', 'None']}
                                onChange={(v: string) => handleChange('provider', v)}
                            />
                            <FormInput label="API Key" value={formData.api_key} onChange={(v: string) => handleChange('api_key', v)} type="password" />
                            <FormInput label="Base URL" value={formData.base_url} onChange={(v: string) => handleChange('base_url', v)} placeholder="Optional" />
                            <FormInput label="Model ID" value={formData.model_id} onChange={(v: string) => handleChange('model_id', v)} />
                            <FormTextarea label="System Prompt" value={formData.prompt} onChange={(v: string) => handleChange('prompt', v)} />
                        </>
                    )}

                    {/* Forwarder Editor */}
                    {node.type === 'forwarder' && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <FormInput label="Name" value={formData.name} onChange={(v: string) => handleChange('name', v)} />
                                <FormInput label="Task Title" value={formData.task_title} onChange={(v: string) => handleChange('task_title', v)} />
                            </div>
                            <FormSelect
                                label="Task Type"
                                value={formData.task_type}
                                options={['article', 'follows']}
                                onChange={(v: string) => handleChange('task_type', v)}
                            />

                            <h3 className="text-sm font-bold text-orange-300 border-b border-orange-500/30 pb-1 mt-4">Source Matcher</h3>
                            <div className="text-xs text-white/50 mb-2">Configure these to match the source Crawler.</div>
                            <FormInput label="Origin (Username)" value={formData.origin} onChange={(v: string) => handleChange('origin', v)} />
                            <FormTextarea label="Paths (List ID)" value={formData.paths} onChange={(v: string) => handleChange('paths', v)} />
                            <FormTextarea label="Websites (Exact URL)" value={formData.websites} onChange={(v: string) => handleChange('websites', v)} />

                            <h3 className="text-sm font-bold text-orange-300 border-b border-orange-500/30 pb-1 mt-4">Formatter & Execution</h3>
                            <FormSelect
                                label="Render Type (Formatter)"
                                value={formData.render_type}
                                options={[
                                    { label: 'Text Only', value: 'text' },
                                    { label: 'Standard Image Card', value: 'img' },
                                    { label: 'Image with Metadata', value: 'img-with-meta' }
                                ]}
                                onChange={(v: string) => handleChange('render_type', v)}
                            />
                            <FormInput label="Execution Cron" value={formData.cron} onChange={(v: string) => handleChange('cron', v)} placeholder="* * * * *" />
                            <div className="grid grid-cols-2 gap-4">
                                <FormTextarea label="Accept Keywords" value={formData.accept_keywords} onChange={(v: string) => handleChange('accept_keywords', v)} placeholder="One per line" fontMono />
                                <FormTextarea label="Filter Keywords (Block)" value={formData.filter_keywords} onChange={(v: string) => handleChange('filter_keywords', v)} placeholder="One per line" fontMono />
                            </div>
                        </>
                    )}

                    {/* Formatter Editor */}
                    {node.type === 'formatter' && (
                        <FormSelect
                            label="Format / Layout"
                            value={formData.render_type}
                            options={[
                                { label: 'Text Only', value: 'text' },
                                { label: 'Standard Image Card', value: 'img' },
                                { label: 'Image with Metadata', value: 'img-with-meta' }
                            ]}
                            onChange={(v: string) => handleChange('render_type', v)}
                        />
                    )}

                    {/* Target Editor */}
                    {node.type === 'target' && (
                        <>
                            <FormSelect
                                label="Platform"
                                value={formData.platform}
                                options={['telegram', 'bilibili', 'qq', 'none']}
                                onChange={(v: string) => handleChange('platform', v)}
                            />
                            <FormInput label="Unique ID (Optional)" value={formData.id} onChange={(v: string) => handleChange('id', v)} placeholder="Leave blank for auto-hash" />

                            <div className="p-4 bg-white/5 rounded-lg border border-white/10 space-y-4">
                                {formData.platform === 'telegram' && (
                                    <>
                                        <h3 className="font-bold text-sm text-blue-300">Telegram</h3>
                                        <FormInput label="Bot Token" value={formData.tg_token} onChange={(v: string) => handleChange('tg_token', v)} />
                                        <FormInput label="Chat ID" value={formData.tg_chat_id} onChange={(v: string) => handleChange('tg_chat_id', v)} />
                                    </>
                                )}
                                {formData.platform === 'qq' && (
                                    <>
                                        <h3 className="font-bold text-sm text-blue-300">QQ</h3>
                                        <FormInput label="API URL" value={formData.qq_url} onChange={(v: string) => handleChange('qq_url', v)} />
                                        <FormInput label="Token" value={formData.qq_token} onChange={(v: string) => handleChange('qq_token', v)} />
                                        <FormInput label="Group ID" value={formData.qq_group_id} onChange={(v: string) => handleChange('qq_group_id', v)} />
                                    </>
                                )}
                                {formData.platform === 'bilibili' && (
                                    <>
                                        <h3 className="font-bold text-sm text-pink-300">Bilibili</h3>
                                        <div className="flex gap-2 items-end">
                                            <FormSelect label="Import from Cookie" value="" options={['...', ...availableCookies]} onChange={handleImportBilibiliCookies} />
                                        </div>
                                        <FormInput label="SESSDATA" value={formData.bili_sessdata} onChange={(v: string) => handleChange('bili_sessdata', v)} type="password" />
                                        <FormInput label="Bili JCT" value={formData.bili_jct} onChange={(v: string) => handleChange('bili_jct', v)} type="password" />
                                    </>
                                )}
                            </div>

                            <div className="mt-4 pt-4 border-t border-white/10">
                                <h3 className="font-bold text-sm text-white/60 mb-2">Global Rules</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormTextarea label="Accept Keywords" value={formData.accept_keywords} onChange={(v: string) => handleChange('accept_keywords', v)} placeholder="One per line" fontMono />
                                    <FormTextarea label="Filter Keywords" value={formData.filter_keywords} onChange={(v: string) => handleChange('filter_keywords', v)} placeholder="One per line" fontMono />
                                </div>
                                <FormTextarea label="Replace Regex (String or JSON)" value={formData.replace_regex} onChange={(v: string) => handleChange('replace_regex', v)} fontMono />
                                <FormInput label="Block Until (Time)" value={formData.block_until} onChange={(v: string) => handleChange('block_until', v)} placeholder="e.g. 1h" />
                            </div>
                        </>
                    )}
                </div>

                <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-white/70 hover:bg-white/10 transition-colors">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium">Save Changes</button>
                </div>
            </div>
        </div>
    );
}

// Helper Components
function FormInput({ label, value, onChange, type = 'text', placeholder }: any) {
    return (
        <div>
            <label className="block text-sm font-medium text-white/80 mb-1">{label}</label>
            <input
                type={type}
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
        </div>
    );
}

function FormTextarea({ label, value, onChange, fontMono }: any) {
    return (
        <div>
            <label className="block text-sm font-medium text-white/80 mb-1">{label}</label>
            <textarea
                rows={4}
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                className={`w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 ${fontMono ? 'font-mono text-xs' : ''}`}
            />
        </div>
    );
}

function FormSelect({ label, value, options, onChange }: any) {
    return (
        <div className="flex-grow">
            <label className="block text-sm font-medium text-white/80 mb-1">{label}</label>
            <select
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                className="w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
                {options.map((opt: any) => {
                    const label = typeof opt === 'object' ? opt.label : opt;
                    const val = typeof opt === 'object' ? opt.value : opt;
                    return <option key={val} value={val}>{label}</option>;
                })}
            </select>
        </div>
    );
}
