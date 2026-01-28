'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/middleware/WithAuth';
import ConfigNode from './components/ConfigNode';
import ConfigEditor from './components/ConfigEditor';
import ReviewModal from './components/ReviewModal';
import { AppConfig, VisualNode, VisualConnection, NodeType, Crawler, Forwarder, ForwardTarget } from './types';
import _ from 'lodash';

export default function ConfigPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    // State
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [nodes, setNodes] = useState<VisualNode[]>([]);
    const [connections, setConnections] = useState<VisualConnection[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [showReview, setShowReview] = useState(false);

    // Editor State
    const [editingNode, setEditingNode] = useState<VisualNode | null>(null);
    const [restarting, setRestarting] = useState(false);

    // Connection State (Drag & Click)
    const [isDragging, setIsDragging] = useState(false);
    const [dragSource, setDragSource] = useState<string | null>(null);
    const [connectingSource, setConnectingSource] = useState<string | null>(null); // For Click-to-Connect
    const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const canvasRef = useRef<HTMLDivElement>(null);

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
            setOriginalConfig(_.cloneDeep(configData));
            setHasChanges(false);
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

        // Get all data
        const crawlers = data.crawlers || [];
        const forwarders = data.forwarders || [];
        const translators = data.translators || [];
        const formatters = data.formatters || [];
        const targets = data.forward_targets || [];

        // Helper to generate IDs
        const getNodeId = (type: NodeType, index: number, id?: string) => {
            return id || `${type}-${index}`;
        };

        // Layer 0: Crawlers
        crawlers.forEach((crawler, i) => {
            const nodeId = getNodeId('crawler', i, crawler.name);

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
        });

        // Layer 0.5: Forwarders (Independent)
        forwarders.forEach((forwarder, i) => {
            const nodeId = getNodeId('forwarder', i, forwarder.id);

            newNodes.push({
                id: nodeId,
                type: 'forwarder',
                label: forwarder.name || `Forwarder ${i + 1}`,
                data: forwarder,
                x: 0 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: (crawlers.length + i) * (NODE_HEIGHT + NODE_GAP) + 120, // Offset below crawlers
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });
        });

        // Layer 1: Translators (Independent)
        translators.forEach((translator, i) => {
            const translatorId = getNodeId('translator', i, translator.id);
            newNodes.push({
                id: translatorId,
                type: 'translator',
                label: translator.name || `${translator.provider} Translator`,
                data: translator,
                x: 1 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: i * (NODE_HEIGHT + NODE_GAP) + 100,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });
        });

        // Also handle legacy translators embedded in crawlers
        crawlers.forEach((crawler, i) => {
            if (crawler.cfg_crawler?.translator && !crawler.cfg_crawler.translator_id) {
                const translatorId = `translator-legacy-${i}`;
                newNodes.push({
                    id: translatorId,
                    type: 'translator',
                    label: `${crawler.cfg_crawler.translator.provider} (Legacy)`,
                    data: crawler.cfg_crawler.translator,
                    x: 1 * (LAYER_WIDTH + LAYER_GAP) + 50,
                    y: (translators.length + i) * (NODE_HEIGHT + NODE_GAP) + 100,
                    width: LAYER_WIDTH,
                    height: NODE_HEIGHT,
                    parentId: getNodeId('crawler', i, crawler.name)
                });

                // Auto-connect legacy translator to its crawler
                newConnections.push({
                    id: `conn-c-t-legacy-${i}`,
                    source: getNodeId('crawler', i, crawler.name),
                    target: translatorId,
                    type: 'crawler-translator'
                });
            }
        });

        // Layer 2: Formatters (Independent)
        formatters.forEach((formatter, i) => {
            const formatterId = getNodeId('formatter', i, formatter.id);

            const label = (() => {
                switch (formatter.render_type) {
                    case 'text': return 'Text Only';
                    case 'img': return 'Image Card';
                    case 'img-with-meta': return 'Image + Meta';
                    case 'img-with-source': return 'Image + Source';
                    case 'img-with-source-summary': return 'Image + Source + Summary';
                    default: return formatter.name || formatter.render_type;
                }
            })();

            newNodes.push({
                id: formatterId,
                type: 'formatter',
                label: formatter.name || label,
                data: formatter,
                x: 2 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: i * (NODE_HEIGHT + NODE_GAP) + 100,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });
        });

        // Layer 3: Targets
        targets.forEach((target, i) => {
            const targetId = getNodeId('target', i, target.id);

            newNodes.push({
                id: targetId,
                type: 'target',
                label: `${target.platform} (${target.id || 'Global'})`,
                data: target,
                x: 3 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: i * (NODE_HEIGHT + NODE_GAP) + 100,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });
        });

        // Build connections from ConnectionMap
        const connMap = data.connections || {};

        // Crawler -> Translator connections
        Object.entries(connMap['crawler-translator'] || {}).forEach(([crawlerId, translatorId]) => {
            newConnections.push({
                id: `conn-ct-${crawlerId}-${translatorId}`,
                source: crawlerId,
                target: translatorId,
                type: 'crawler-translator'
            });
        });

        // Translator -> Formatter connections
        Object.entries(connMap['translator-formatter'] || {}).forEach(([translatorId, formatterIds]) => {
            formatterIds.forEach(formatterId => {
                newConnections.push({
                    id: `conn-tf-${translatorId}-${formatterId}`,
                    source: translatorId,
                    target: formatterId,
                    type: 'translator-formatter'
                });
            });
        });

        // Crawler -> Formatter connections (direct, no translator)
        Object.entries(connMap['crawler-formatter'] || {}).forEach(([crawlerId, formatterIds]) => {
            formatterIds.forEach(formatterId => {
                newConnections.push({
                    id: `conn-cf-${crawlerId}-${formatterId}`,
                    source: crawlerId,
                    target: formatterId,
                    type: 'crawler-formatter'
                });
            });
        });

        // Formatter -> Target connections
        Object.entries(connMap['formatter-target'] || {}).forEach(([formatterId, targetIds]) => {
            targetIds.forEach(targetId => {
                newConnections.push({
                    id: `conn-ft-${formatterId}-${targetId}`,
                    source: formatterId,
                    target: targetId,
                    type: 'formatter-target'
                });
            });
        });

        // Forwarder -> Target connections
        Object.entries(connMap['forwarder-target'] || {}).forEach(([forwarderId, targetIds]) => {
            targetIds.forEach(targetId => {
                newConnections.push({
                    id: `conn-ft-direct-${forwarderId}-${targetId}`,
                    source: forwarderId,
                    target: targetId,
                    type: 'forwarder-target' as any
                });
            });
        });



        setNodes(newNodes);
        setConnections(newConnections);
    };

    const handleNodeSave = async (node: VisualNode, newData: any) => {
        if (!config) return;
        const newConfig = _.cloneDeep(config);

        // Parse node ID to determine type
        const idParts = node.id.split('-');
        const type = idParts[0];

        if (type === 'crawler') {
            // Find crawler by ID or name
            const crawlerIndex = newConfig.crawlers?.findIndex(c =>
                c.name === node.data.name || newConfig.crawlers?.indexOf(c) === parseInt(idParts[1])
            );
            if (crawlerIndex !== undefined && crawlerIndex >= 0 && newConfig.crawlers) {
                newConfig.crawlers[crawlerIndex] = newData as Crawler;
            }
        } else if (type === 'translator') {
            // Check if it's a legacy translator
            if (idParts[1] === 'legacy') {
                const crawlerIndex = parseInt(idParts[2]);
                if (newConfig.crawlers && newConfig.crawlers[crawlerIndex]) {
                    if (!newConfig.crawlers[crawlerIndex].cfg_crawler) {
                        newConfig.crawlers[crawlerIndex].cfg_crawler = {};
                    }
                    newConfig.crawlers[crawlerIndex].cfg_crawler!.translator = newData;
                }
            } else {
                // Independent translator
                if (!newConfig.translators) newConfig.translators = [];
                const translatorIndex = newConfig.translators.findIndex(t =>
                    t.id === node.data.id || newConfig.translators?.indexOf(t) === parseInt(idParts[1])
                );
                if (translatorIndex >= 0) {
                    newConfig.translators[translatorIndex] = newData;
                } else {
                    newConfig.translators.push(newData);
                }
            }
        } else if (type === 'formatter') {
            // Independent formatter
            if (!newConfig.formatters) newConfig.formatters = [];
            const formatterIndex = newConfig.formatters.findIndex(f =>
                f.id === node.data.id || newConfig.formatters?.indexOf(f) === parseInt(idParts[1])
            );
            if (formatterIndex >= 0) {
                newConfig.formatters[formatterIndex] = newData;
            } else {
                newConfig.formatters.push(newData);
            }
        } else if (type === 'forwarder') {
            const forwarderIndex = newConfig.forwarders?.findIndex(f =>
                f.id === node.data.id || newConfig.forwarders?.indexOf(f) === parseInt(idParts[1])
            );
            if (forwarderIndex !== undefined && forwarderIndex >= 0 && newConfig.forwarders) {
                newConfig.forwarders[forwarderIndex] = newData as Forwarder;
            } else if (newConfig.forwarders) {
                // Fallback by index if id not found
                const idx = parseInt(idParts[1]);
                if (newConfig.forwarders[idx]) {
                    newConfig.forwarders[idx] = newData as Forwarder;
                }
            }
        } else if (type === 'target') {
            // Find target by ID
            const targetIndex = newConfig.forward_targets?.findIndex(t =>
                t.id === node.data.id || newConfig.forward_targets?.indexOf(t) === parseInt(idParts[1])
            );
            if (targetIndex !== undefined && targetIndex >= 0 && newConfig.forward_targets) {
                newConfig.forward_targets[targetIndex] = newData as ForwardTarget;
            }
        }

        setConfig(newConfig);
        processGraph(newConfig);
        setEditingNode(null);
        setHasChanges(true);

        // Auto-save to backend -> DISABLED for manual review
        // saveConfigToBackend(newConfig);
    };

    // Drag-to-Connect Handlers
    const isValidConnection = (sourceNode?: VisualNode, targetNode?: VisualNode): boolean => {
        if (!sourceNode || !targetNode) return false;

        // Define valid connection rules
        const validConnections: Record<string, string[]> = {
            'crawler': ['translator', 'formatter'],
            'translator': ['formatter'],
            'formatter': ['target'],
            'forwarder': ['target']
        };

        return validConnections[sourceNode.type]?.includes(targetNode.type) || false;
    };

    const handleConnectionStart = (nodeId: string, side: 'output') => {
        setIsDragging(true);
        setDragSource(nodeId);
    };

    const handleConnectionEnd = (nodeId: string, side: 'input') => {
        const sourceId = dragSource || connectingSource;

        if (!sourceId || sourceId === nodeId) {
            setIsDragging(false);
            setDragSource(null);
            setConnectingSource(null);
            return;
        }

        // Validate connection
        const sourceNode = nodes.find(n => n.id === sourceId);
        const targetNode = nodes.find(n => n.id === nodeId);

        if (!isValidConnection(sourceNode, targetNode)) {
            alert('Invalid connection! Please follow: Crawler → Translator/Formatter, Translator → Formatter, Formatter → Target');
            setIsDragging(false);
            setDragSource(null);
            setConnectingSource(null);
            return;
        }

        // Add new connection
        addConnection(sourceId, nodeId);
        setIsDragging(false);
        setDragSource(null);
        setConnectingSource(null);
    };

    const handleHandleClick = (nodeId: string, side: 'input' | 'output') => {
        if (side === 'output') {
            // Start connection
            if (connectingSource === nodeId) {
                setConnectingSource(null); // Deselect
            } else {
                setConnectingSource(nodeId);
            }
        } else if (side === 'input') {
            // Complete connection if active
            if (connectingSource) {
                handleConnectionEnd(nodeId, 'input');
            }
        }
    };

    const addConnection = (sourceId: string, targetId: string) => {
        if (!config) return;

        // Check if connection already exists
        if (connections.some(c => c.source === sourceId && c.target === targetId)) {
            alert('Connection already exists!');
            return;
        }

        const sourceNode = nodes.find(n => n.id === sourceId);
        const targetNode = nodes.find(n => n.id === targetId);
        if (!sourceNode || !targetNode) return;

        // Determine connection type
        const connType = `${sourceNode.type}-${targetNode.type}` as any;

        const newConn: VisualConnection = {
            id: `conn-${sourceId}-${targetId}-${Date.now()}`,
            source: sourceId,
            target: targetId,
            type: connType
        };

        setConnections(prev => [...prev, newConn]);

        // Update config connections map
        const newConfig = _.cloneDeep(config);
        if (!newConfig.connections) newConfig.connections = {};

        if (connType === 'crawler-translator') {
            if (!newConfig.connections['crawler-translator']) newConfig.connections['crawler-translator'] = {};
            newConfig.connections['crawler-translator'][sourceId] = targetId;
        } else if (connType === 'translator-formatter') {
            if (!newConfig.connections['translator-formatter']) newConfig.connections['translator-formatter'] = {};
            if (!newConfig.connections['translator-formatter'][sourceId]) newConfig.connections['translator-formatter'][sourceId] = [];
            newConfig.connections['translator-formatter'][sourceId].push(targetId);
        } else if (connType === 'crawler-formatter') {
            if (!newConfig.connections['crawler-formatter']) newConfig.connections['crawler-formatter'] = {};
            if (!newConfig.connections['crawler-formatter'][sourceId]) newConfig.connections['crawler-formatter'][sourceId] = [];
            newConfig.connections['crawler-formatter'][sourceId].push(targetId);
        } else if (connType === 'formatter-target') {
            if (!newConfig.connections['formatter-target']) newConfig.connections['formatter-target'] = {};
            if (!newConfig.connections['formatter-target'][sourceId]) newConfig.connections['formatter-target'][sourceId] = [];
            if (!newConfig.connections['formatter-target'][sourceId]) newConfig.connections['formatter-target'][sourceId] = [];
            newConfig.connections['formatter-target'][sourceId].push(targetId);
        } else if (connType === 'forwarder-target') {
            if (!newConfig.connections['forwarder-target']) newConfig.connections['forwarder-target'] = {};
            if (!newConfig.connections['forwarder-target'][sourceId]) newConfig.connections['forwarder-target'][sourceId] = [];
            newConfig.connections['forwarder-target'][sourceId].push(targetId);
        }

        setConfig(newConfig);
        setHasChanges(true);
        // saveConfigToBackend(newConfig);
    };

    const removeConnection = (connId: string) => {
        if (!config) return;

        const conn = connections.find(c => c.id === connId);
        if (!conn) return;

        setConnections(prev => prev.filter(c => c.id !== connId));

        // Update config
        const newConfig = _.cloneDeep(config);
        if (!newConfig.connections) return;

        const connMap = newConfig.connections[conn.type!];
        if (!connMap) return;

        if (conn.type === 'crawler-translator') {
            delete connMap[conn.source];
        } else {
            const targets = connMap[conn.source] as string[];
            if (targets) {
                connMap[conn.source] = targets.filter(t => t !== conn.target);
            }
        }

        setConfig(newConfig);
        setHasChanges(true);
        // saveConfigToBackend(newConfig);
    };

    const addNewFormatter = () => {
        if (!config) return;

        const newFormatter = {
            id: `formatter-${Date.now()}`,
            name: 'New Formatter',
            render_type: 'text' as const
        };

        const newConfig = _.cloneDeep(config);
        if (!newConfig.formatters) newConfig.formatters = [];
        newConfig.formatters.push(newFormatter);

        setConfig(newConfig);
        processGraph(newConfig);
        setHasChanges(true);
        // saveConfigToBackend(newConfig);
    };

    const addNewTarget = () => {
        if (!config) return;

        const newTarget = {
            platform: 'telegram',
            id: `target-${Date.now()}`,
            cfg_platform: {}
        };

        const newConfig = _.cloneDeep(config);
        if (!newConfig.forward_targets) newConfig.forward_targets = [];
        newConfig.forward_targets.push(newTarget);

        setConfig(newConfig);
        processGraph(newConfig);
        setHasChanges(true);
        // saveConfigToBackend(newConfig);
    };

    const saveConfigToBackend = async (configToSave: AppConfig) => {
        try {
            setStatus('Saving...');
            const res = await fetch('/api/config/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configToSave)
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
                    {hasChanges && (
                        <span className="text-xs px-2 py-1 rounded bg-yellow-500/20 text-yellow-300 animate-pulse font-bold">
                            ● Unsaved Changes
                        </span>
                    )}
                </div>
                <div className="flex gap-3">
                    {config && hasChanges && (
                        <button
                            onClick={() => setShowReview(true)}
                            className="px-4 py-1 bg-green-600 hover:bg-green-700 text-white rounded font-bold shadow-lg shadow-green-900/20 transition-all flex items-center gap-2"
                        >
                            <span>💾</span> Save Changes
                        </button>
                    )}
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
                        {hasChanges ? 'Discard & Refresh' : 'Refresh'}
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
            <div
                ref={canvasRef}
                className="flex-grow relative overflow-auto bg-[url('/grid.svg')] bg-fixed"
                style={{ backgroundSize: '20px 20px' }}
                onMouseMove={(e) => {
                    if (isDragging && canvasRef.current) {
                        const rect = canvasRef.current.getBoundingClientRect();
                        setMousePos({
                            x: e.clientX - rect.left + canvasRef.current.scrollLeft,
                            y: e.clientY - rect.top + canvasRef.current.scrollTop
                        });
                    }
                }}
                onMouseUp={() => {
                    if (isDragging) {
                        setIsDragging(false);
                        setDragSource(null);
                        setConnectingSource(null);
                    }
                }}
                onClick={() => {
                    if (connectingSource) {
                        setConnectingSource(null); // Click background to cancel connection
                    }
                }}
            >
                <div className="absolute inset-0 min-w-[1500px] min-h-[1000px]">
                    {/* Action Buttons */}
                    <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                        <button
                            onClick={addNewFormatter}
                            className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105"
                        >
                            <span className="text-lg">+</span> Add Formatter
                        </button>
                        <button
                            onClick={addNewTarget}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105"
                        >
                            <span className="text-lg">+</span> Add Target
                        </button>
                    </div>
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

                            const color = conn.type === 'crawler-translator' ? '#8b5cf6' :
                                conn.type === 'translator-formatter' ? '#ec4899' :
                                    conn.type === 'crawler-formatter' ? '#f59e0b' :
                                        conn.type === 'formatter-target' ? '#10b981' :
                                            conn.type === 'forwarder-target' ? '#c026d3' : '#6b7280';

                            return (
                                <g key={conn.id}>
                                    <path
                                        d={`M ${startX} ${startY} C ${startX + 50} ${startY}, ${endX - 50} ${endY}, ${endX} ${endY}`}
                                        fill="none"
                                        stroke={color}
                                        strokeWidth="2"
                                        strokeDasharray="5,5"
                                        className="cursor-pointer hover:stroke-red-500 hover:opacity-100 transition-all"
                                        style={{ pointerEvents: 'stroke', opacity: 0.6 }}
                                        onClick={() => {
                                            if (confirm('Delete this connection?')) {
                                                removeConnection(conn.id);
                                            }
                                        }}
                                    />
                                </g>
                            );
                        })}

                        {/* Temporary drag connection */}
                        {isDragging && dragSource && (() => {
                            const sourceNode = nodes.find(n => n.id === dragSource);
                            if (!sourceNode) return null;
                            const startX = sourceNode.x + sourceNode.width;
                            const startY = sourceNode.y + sourceNode.height / 2;
                            return (
                                <line
                                    x1={startX}
                                    y1={startY}
                                    x2={mousePos.x}
                                    y2={mousePos.y}
                                    stroke="#4ade80"
                                    strokeWidth="3"
                                    strokeDasharray="5,5"
                                    opacity="0.7"
                                />
                            );
                        })()}
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
                            onConnectionStart={handleConnectionStart}
                            onConnectionEnd={handleConnectionEnd}
                            onHandleClick={handleHandleClick}
                            isConnecting={isDragging || !!connectingSource}
                            isConnectingSource={connectingSource === node.id}
                        />
                    ))}

                    {/* Node Layers Labels */}
                    <div className="absolute top-4 left-[50px] text-white/20 font-bold text-xl">CRAWLERS</div>
                    <div className="absolute top-4 left-[400px] text-white/20 font-bold text-xl">TRANSLATORS</div>
                    <div className="absolute top-4 left-[750px] text-white/20 font-bold text-xl">FORMATTERS</div>
                    <div className="absolute top-4 left-[1100px] text-white/20 font-bold text-xl">TARGETS</div>
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

            {/* Review Modal */}
            {showReview && config && originalConfig && (
                <ReviewModal
                    originalConfig={originalConfig}
                    newConfig={config}
                    onCancel={() => setShowReview(false)}
                    onConfirm={() => {
                        saveConfigToBackend(config);
                        setShowReview(false);
                        setHasChanges(false);
                        setOriginalConfig(_.cloneDeep(config));
                    }}
                />
            )}
        </div>
    );
}
