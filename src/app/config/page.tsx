'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/middleware/WithAuth';
import ConfigNode from './components/ConfigNode';
import ConfigEditor from './components/ConfigEditor';
import { AppConfig, VisualNode, VisualConnection, NodeType, Crawler, Forwarder, ForwardTarget } from './types';
import _ from 'lodash';

export default function ConfigPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // State
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [nodes, setNodes] = useState<VisualNode[]>([]);
    const [connections, setConnections] = useState<VisualConnection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);

    // Editor State
    const [editingNode, setEditingNode] = useState<VisualNode | null>(null);
    const [restarting, setRestarting] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/auth/login?redirect=/config');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        if (user) {
            fetchConfig();
        }
    }, [user]);

    // Layout Constants
    const LAYER_WIDTH = 250;
    const LAYER_GAP = 100;
    const NODE_HEIGHT = 100;
    const NODE_GAP = 20;

    const [availableCookies, setAvailableCookies] = useState<string[]>([]);

    const fetchConfig = async () => {
        setLoading(true);
        setError('');
        try {
            const [configRes, cookiesRes] = await Promise.all([
                fetch('/api/config'),
                fetch('/api/cookies/list')
            ]);

            if (configRes.status === 401 || cookiesRes.status === 401) {
                router.push('/auth/login?redirect=/config');
                return;
            }
            if (!configRes.ok) throw new Error('Failed to fetch config');

            const configData = await configRes.json() as AppConfig;
            setConfig(configData);
            processGraph(configData);

            if (cookiesRes.ok) {
                const cookiesData = await cookiesRes.json() as any[];
                setAvailableCookies(cookiesData.map((c: any) => c.filename));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    const processGraph = (data: AppConfig) => {
        const newNodes: VisualNode[] = [];
        const newConnections: VisualConnection[] = [];

        // 0. Pre-fetch lists
        const crawlers = data.crawlers || [];
        const forwarders = data.forwarders || [];
        const targets = data.forward_targets || [];

        // 1. Crawlers (Layer 0)
        crawlers.forEach((crawler, i) => {
            const nodeId = `crawler-${i}`;

            // Add Crawler Node
            newNodes.push({
                id: nodeId,
                type: 'crawler',
                label: crawler.name || `Crawler ${i + 1}`,
                data: crawler,
                x: 0 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: i * (NODE_HEIGHT + NODE_GAP) + 100,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });

            // 2. Translator (Layer 1) - Nested in Crawler
            if (crawler.cfg_crawler?.translator) {
                const translatorId = `translator-${i}`;
                newNodes.push({
                    id: translatorId,
                    type: 'translator',
                    label: `Translate (${crawler.cfg_crawler.translator.provider})`,
                    data: crawler.cfg_crawler.translator,
                    x: 1 * (LAYER_WIDTH + LAYER_GAP) + 50,
                    y: i * (NODE_HEIGHT + NODE_GAP) + 100, // Align with crawler
                    width: LAYER_WIDTH,
                    height: NODE_HEIGHT,
                    parentId: nodeId
                });
                newConnections.push({
                    id: `conn-c-t-${i}`,
                    source: nodeId,
                    target: translatorId
                });
            }


            // Connect to Forwarders
            // Logic: If forwarder filters websites matching crawler websites, or just implicit left-right for now.
            // Improved: Connect all crawlers to first forwarder visually if no logic, OR just leave disconnected?
            // User requested connections. Let's connect Crawler -> Forwarder (generic) or simple 1-to-1 if index matches to show "flow".
            // Let's do 1-to-1 connection based on index for visual flow if count matches, otherwise 0->0, 1->1, etc.
            if (forwarders[i]) {
                const forwarderId = `forwarder-${i}`;
                const sourceId = crawler.cfg_crawler?.translator ? `translator-${i}` : nodeId;

                newConnections.push({
                    id: `conn-flow-${i}`,
                    source: sourceId,
                    target: forwarderId
                });
            }
        });

        // 3. Forwarders (Layer 2)
        forwarders.forEach((forwarder, i) => {
            const forwarderId = `forwarder-${i}`;
            const yPos = i * (NODE_HEIGHT + NODE_GAP) + 100;

            // Check if already exist (added by crawler loop logic? No, nodes are needed)
            // Wait, we pushed nodes in previous loop? No, that was Crawlers loop.
            // Warning: logic above accessed `forwarders[i]` inside `crawlers` loop to make connection. 
            // We need to ensure Forwarder Nodes exist. 
            // Better: Create all nodes first, then connections? 
            // Original code created nodes in separate loops. 

            newNodes.push({
                id: forwarderId,
                type: 'forwarder',
                label: forwarder.name || `Forwarder ${i + 1}`,
                data: forwarder,
                x: 2 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: yPos,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });

            // 4. Formatter (Layer 3) - Nested in Forwarder
            const renderType = forwarder.cfg_forwarder?.render_type || 'text';
            const formatterId = `formatter-${i}`;

            newNodes.push({
                id: formatterId,
                type: 'formatter',
                label: `Format: ${renderType}`,
                data: forwarder.cfg_forwarder || {},
                x: 3 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: yPos,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT,
                parentId: forwarderId
            });
            newConnections.push({
                id: `conn-f-fmt-${i}`,
                source: forwarderId,
                target: formatterId
            });

            // Connect Formatter -> Target (Layer 4)
            // Logic: 1-to-1 match with Targets by index for visualization
            if (data.forward_targets && data.forward_targets[i]) {
                const targetId = `target-${i}`;
                newConnections.push({
                    id: `conn-fmt-t-${i}`,
                    source: formatterId,
                    target: targetId
                });
            }
        });

        // 5. Targets (Layer 4)
        targets.forEach((target, i) => {
            const targetId = `target-${i}`;
            const yPos = i * (NODE_HEIGHT + NODE_GAP) + 100;

            newNodes.push({
                id: targetId,
                type: 'target',
                label: `${target.platform} (${target.id || 'Global'})`,
                data: target,
                x: 4 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: yPos,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });
        });

        setNodes(newNodes);
        setConnections(newConnections);
    };

    const handleNodeSave = async (node: VisualNode, newData: any) => {
        if (!config) return;
        const newConfig = _.cloneDeep(config); // Deep clone to avoid mutation issues

        // Update the config object based on node type and ID
        // Note: Graph generation used index. IDs are `type-index`.
        const [type, indexStr] = node.id.split('-');
        const index = parseInt(indexStr);

        if (type === 'crawler') {
            if (newConfig.crawlers && newConfig.crawlers[index]) {
                newConfig.crawlers[index] = newData as Crawler;
            }
        } else if (type === 'translator') {
            // Translator is inside crawler. Node was generated from crawler index (assumed 1-1 mapping for visual simplicity logic above)
            // But wait, my graph logic `translator-${i}` matches `crawler-${i}`. Yes.
            if (newConfig.crawlers && newConfig.crawlers[index]) {
                if (!newConfig.crawlers[index].cfg_crawler) newConfig.crawlers[index].cfg_crawler = {};
                newConfig.crawlers[index].cfg_crawler!.translator = newData;
            }
        } else if (type === 'forwarder') {
            if (newConfig.forwarders && newConfig.forwarders[index]) {
                newConfig.forwarders[index] = newData as Forwarder;
            }
        } else if (type === 'formatter') {
            // Formatter is inside forwarder.
            if (newConfig.forwarders && newConfig.forwarders[index]) {
                if (!newConfig.forwarders[index].cfg_forwarder) newConfig.forwarders[index].cfg_forwarder = {};
                // Updates to cfg_forwarder (render_type)
                newConfig.forwarders[index].cfg_forwarder!.render_type = newData.render_type;
            }
        } else if (type === 'target') {
            if (newConfig.forward_targets && newConfig.forward_targets[index]) {
                newConfig.forward_targets[index] = newData as ForwardTarget;
            }
        }

        setConfig(newConfig);
        processGraph(newConfig); // Re-render graph
        setEditingNode(null);

        // Auto-save to backend
        try {
            setStatus('Saving...');
            const res = await fetch('/api/config/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });

            if (!res.ok) throw new Error('Failed to save to backend');

            setStatus('Saved successfully! Restart server to apply.');
        } catch (e: any) {
            setStatus(`Error saving: ${e.message}`);
        }
    };

    const handleRestart = async () => {
        if (!confirm('Are you sure you want to restart the backend server? This will interrupt active tasks.')) return;

        setRestarting(true);
        setStatus('Restarting server...');

        try {
            const res = await fetch('/api/server/restart', { method: 'POST' });
            if (!res.ok) throw new Error('Restart request failed');

            setStatus('Server restart command sent. Please wait for service to recover.');

            // Poll for health or just wait
            setTimeout(() => {
                setRestarting(false);
                setStatus('Server should be back up. Refresh if needed.');
            }, 5000);

        } catch (e: any) {
            setStatus(`Restart Error: ${e.message}`);
            setRestarting(false);
        }
    };

    if (authLoading || !user) {
        return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-[#111] text-white overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-[#1a1a1a] border-b border-white/10 p-4 flex justify-between items-center z-10 shadow-md">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <span>⚙️</span> Configuration Graph
                    </h1>
                    {status && (
                        <span className={`text-xs px-2 py-1 rounded ${status.includes('Error') ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                            {status}
                        </span>
                    )}
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`px-3 py-1 rounded text-sm transition-colors ${showDebug ? 'bg-purple-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                    >
                        Debug Info
                    </button>
                    <button
                        onClick={fetchConfig}
                        className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded text-sm transition-colors"
                        disabled={loading}
                    >
                        Refresh
                    </button>
                    <button
                        onClick={handleRestart}
                        disabled={restarting}
                        className={`px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors flex items-center gap-2 ${restarting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {restarting ? 'Restarting...' : 'Restart Server'}
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div className="flex-grow relative overflow-auto bg-[url('/grid.svg')] bg-fixed" style={{ backgroundSize: '20px 20px' }}>
                <div className="absolute inset-0 min-w-[1500px] min-h-[1000px]">
                    {/* SVG Connections Layer */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                        {connections.map(conn => {
                            const source = nodes.find(n => n.id === conn.source);
                            const target = nodes.find(n => n.id === conn.target);
                            if (!source || !target) return null;

                            const startX = source.x + source.width;
                            const startY = source.y + source.height / 2;
                            const endX = target.x;
                            const endY = target.y + target.height / 2;

                            return (
                                <path
                                    key={conn.id}
                                    d={`M ${startX} ${startY} C ${startX + 50} ${startY}, ${endX - 50} ${endY}, ${endX} ${endY}`}
                                    fill="none"
                                    stroke="#555"
                                    strokeWidth="2"
                                    strokeDasharray="5,5"
                                />
                            );
                        })}
                    </svg>

                    {/* Nodes Layer */}
                    {nodes.length === 0 && !loading && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center p-8 bg-black/50 backdrop-blur-md rounded-xl border border-white/10 select-none pointer-events-auto">
                                <div className="text-4xl mb-4">🕸️</div>
                                <h3 className="text-xl font-bold text-white mb-2">No Configuration Found</h3>
                                <p className="text-white/60 max-w-md">
                                    The crawler/forwarder graph is empty. Please check your backend <code>config.yaml</code> or check console for errors.
                                </p>
                            </div>
                        </div>
                    )}

                    {nodes.map(node => (
                        <ConfigNode
                            key={node.id}
                            node={node}
                            onClick={(n) => setEditingNode(n)}
                        />
                    ))}

                    {/* Node Layers Labels */}
                    <div className="absolute top-4 left-[50px] text-white/20 font-bold text-xl">CRAWLERS</div>
                    <div className="absolute top-4 left-[400px] text-white/20 font-bold text-xl">TRANSLATORS</div>
                    <div className="absolute top-4 left-[750px] text-white/20 font-bold text-xl">FORWARDERS</div>
                    <div className="absolute top-4 left-[1100px] text-white/20 font-bold text-xl">FORMATTERS</div>
                    <div className="absolute top-4 left-[1450px] text-white/20 font-bold text-xl">TARGETS</div>
                </div>
            </div>

            {/* Debug Info Panel */}
            {showDebug && config && (
                <div className="h-64 border-t border-white/10 bg-black/90 p-4 font-mono text-xs overflow-auto">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-bold text-lg text-purple-300">Backend Config Debug</h3>
                        <button onClick={() => setShowDebug(false)} className="text-white/60 hover:text-white">✕ Close</button>
                    </div>
                    <pre className="text-green-400 whitespace-pre-wrap">
                        {JSON.stringify(config, null, 2)}
                    </pre>
                </div>
            )}

            {/* Editor Modal */}
            {editingNode && config && (
                <ConfigEditor
                    node={editingNode}
                    fullConfig={config}
                    availableCookies={availableCookies}
                    onSave={handleNodeSave}
                    onClose={() => setEditingNode(null)}
                />
            )}
        </div>
    );
}
