'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/middleware/WithAuth';
import ConfigNode from './components/ConfigNode';
import ConfigEditor from './components/ConfigEditor';
import ReviewModal from './components/ReviewModal';
import { AppConfig, VisualNode, VisualConnection, NodeType, Crawler, Forwarder, ForwardTarget, ConnectionMap } from './types';
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
    const [groups, setGroups] = useState<{ id: string; label: string; x: number; y: number; width: number; height: number; color: string; isCollapsed: boolean }[]>([]);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
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

    // UI State
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [canvasSize, setCanvasSize] = useState({ width: 2000, height: 1500 });

    // Brush Selection State
    const [isBrushSelecting, setIsBrushSelecting] = useState(false);
    const [brushStart, setBrushStart] = useState({ x: 0, y: 0 });
    const [brushCurrent, setBrushCurrent] = useState({ x: 0, y: 0 });

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
            setHasChanges(false);
            setSelectedNodeIds(new Set());
            setHasChanges(false);
            setHasChanges(false);
            setSelectedNodeIds(new Set());
            processGraph(configData, collapsedGroups);

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

    const processGraph = (data: AppConfig, currentCollapsedGroups: Set<string> = collapsedGroups) => {
        const newNodes: VisualNode[] = [];
        const newConnections: VisualConnection[] = [];

        // Get all data
        const crawlers = data.crawlers || [];
        const forwarders = data.forwarders || [];

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

        // Layer 1: Processors (Independent)
        const processors = data.processors || [];
        processors.forEach((processor, i) => {
            const processorId = getNodeId('processor', i, processor.id);
            newNodes.push({
                id: processorId,
                type: 'processor',
                label: processor.name || `${processor.provider} Processor`,
                data: processor,
                x: 1 * (LAYER_WIDTH + LAYER_GAP) + 50,
                y: i * (NODE_HEIGHT + NODE_GAP) + 100,
                width: LAYER_WIDTH,
                height: NODE_HEIGHT
            });
        });

        // Also handle legacy processors embedded in crawlers
        crawlers.forEach((crawler, i) => {
            if (crawler.cfg_crawler?.processor && !crawler.cfg_crawler.processor_id) {
                const processorId = `processor-legacy-${i}`;
                newNodes.push({
                    id: processorId,
                    type: 'processor',
                    label: `${crawler.cfg_crawler.processor.provider} (Legacy)`,
                    data: crawler.cfg_crawler.processor,
                    x: 1 * (LAYER_WIDTH + LAYER_GAP) + 50,
                    y: (processors.length + i) * (NODE_HEIGHT + NODE_GAP) + 100,
                    width: LAYER_WIDTH,
                    height: NODE_HEIGHT,
                    parentId: getNodeId('crawler', i, crawler.name)
                });

                // Auto-connect legacy processor to its crawler
                newConnections.push({
                    id: `conn-c-p-legacy-${i}`,
                    source: getNodeId('crawler', i, crawler.name),
                    target: processorId,
                    type: 'crawler-processor'
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
                    case 'tag': return 'Tag Only';
                    case 'img-tag': return 'Image + Tag';
                    case 'img-tag-dynamic': return 'Dynamic Image + Tag';
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

        // Crawler -> Processor connections
        Object.entries(connMap['crawler-processor'] || {}).forEach(([crawlerId, processorId]) => {
            newConnections.push({
                id: `conn-cp-${crawlerId}-${processorId}`,
                source: crawlerId,
                target: processorId,
                type: 'crawler-processor'
            });
        });

        // Processor -> Formatter connections
        Object.entries(connMap['processor-formatter'] || {}).forEach(([processorId, formatterIds]) => {
            formatterIds.forEach(formatterId => {
                newConnections.push({
                    id: `conn-pf-${processorId}-${formatterId}`,
                    source: processorId,
                    target: formatterId,
                    type: 'processor-formatter'
                });
            });
        });

        // Crawler -> Formatter connections (direct, no processor)
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



        // Calculate Canvas Size dynamically
        const maxX = Math.max(...newNodes.map(n => n.x + n.width), 1500);
        const maxY = Math.max(...newNodes.map(n => n.y + n.height), 1000);
        setCanvasSize({ width: maxX + 500, height: maxY + 500 });

        // Process Groups
        const groupMap = new Map<string, VisualNode[]>();
        newNodes.forEach(node => {
            if (node.data.group) {
                if (!groupMap.has(node.data.group)) groupMap.set(node.data.group, []);
                groupMap.get(node.data.group)!.push(node);
            }
        });

        // Determine Group Bounding Boxes & Colors
        const groupConfigs = Array.from(groupMap.entries()).map(([label, groupNodes], i) => {
            const minX = Math.min(...groupNodes.map(n => n.x));
            const minY = Math.min(...groupNodes.map(n => n.y));
            const maxX = Math.max(...groupNodes.map(n => n.x + n.width));
            const maxY = Math.max(...groupNodes.map(n => n.y + n.height));

            // Deterministic color
            const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'];
            const colorIndex = label.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
            const color = colors[colorIndex];
            const groupId = `group-${label}`;

            return {
                id: groupId,
                label,
                x: minX - 20,
                y: minY - 40,
                width: maxX - minX + 40,
                height: maxY - minY + 60,
                color,
                isCollapsed: currentCollapsedGroups.has(groupId),
                members: groupNodes
            };
        });

        // --- Collapsing Logic ---
        const finalNodes: VisualNode[] = [];
        const hiddenNodeMap = new Map<string, string>(); // hiddenNodeId -> groupId

        // 1. Filter Nodes & Create Group Nodes
        const processedGroupIds = new Set<string>();

        // Add non-grouped nodes first (or check later)
        // Actually simpler: iterate all newNodes. If in collapsed group, skip.
        // But we need to insert the Group Node once.

        groupConfigs.forEach(g => {
            if (g.isCollapsed) {
                // Add Group Node
                finalNodes.push({
                    id: g.id,
                    type: 'group',
                    label: `${g.label} (${g.members.length})`,
                    data: { group: g.label, isGroupNode: true, members: g.members }, // storing members for bulk actions later
                    x: g.x,
                    y: g.y,
                    width: Math.max(g.width, 200), // Collapsed width
                    height: 80 // Collapsed height
                });

                // Mark members as hidden
                g.members.forEach(m => hiddenNodeMap.set(m.id, g.id));
            }
        });

        newNodes.forEach(n => {
            if (!hiddenNodeMap.has(n.id)) {
                finalNodes.push(n);
            }
        });

        // 2. Remap Connections
        const finalConnections: VisualConnection[] = [];
        const connectionKeys = new Set<string>(); // avoid duplicates

        newConnections.forEach(conn => {
            let source = conn.source;
            let target = conn.target;
            let isPartial = false;

            // Map to group if hidden
            if (hiddenNodeMap.has(source)) source = hiddenNodeMap.get(source)!;
            if (hiddenNodeMap.has(target)) target = hiddenNodeMap.get(target)!;

            // Check if this is a connection involving a group
            // We want to detect "Partial" connections for Group->Node or Group->Group or Node->Group
            // Partial = Not all members of the source group connect to this target

            // Case 1: Source is a Group
            if (currentCollapsedGroups.has(source)) {
                // Find group config
                const groupConfig = groupConfigs.find(g => g.id === source);
                if (groupConfig) {
                    // Count how many members connect to the *original* target (before mapping target to group)?
                    // No, connect to the *resolved* target.
                    // If multiple members connect to the same resolved target, we count them.

                    // Actually, we need to look at the ORIGINAL connections to determine partiality.
                    // Let's filter original 'newConnections' for this specific resolved relationship.

                    // But we are in a loop of single connection.
                    // Use a helper or pre-calc?
                    // Pre-calc is better.
                }
            }

            const key = `${source}-${target}`;
            if (!connectionKeys.has(key)) {
                connectionKeys.add(key);
                finalConnections.push({
                    ...conn,
                    id: `conn-${source}-${target}`, // New ID for visual
                    source,
                    target,
                    // We need to determine if it's partial later... defaulting to original type
                });
            }
        });

        // 3. Post-process connections for Partial Status
        // For each final connection X -> Y
        finalConnections.forEach(conn => {
            const sourceGroup = groupConfigs.find(g => g.id === conn.source);
            if (sourceGroup) {
                // It is a group source. Check coverage.
                const totalMembers = sourceGroup.members.length;
                // Find all original connections where mapped(source) == conn.source AND mapped(target) == conn.target
                const contributingConns = newConnections.filter(c => {
                    const mappedS = hiddenNodeMap.get(c.source) || c.source;
                    const mappedT = hiddenNodeMap.get(c.target) || c.target;
                    return mappedS === conn.source && mappedT === conn.target;
                });

                // How many unique members of sourceGroup are involved?
                const involvedMembers = new Set(contributingConns.map(c => c.source)); // original source
                if (involvedMembers.size < totalMembers) {
                    // Partial!
                    (conn as any).isPartial = true;
                }
            }
        });

        setNodes(finalNodes);
        setConnections(finalConnections);
        setGroups(groupConfigs);
    };

    const handleNodeSave = async (node: VisualNode, newData: any) => {
        if (!config) return;
        const newConfig = _.cloneDeep(config);

        // Parse node ID to determine type
        const idParts = node.id.split('-');
        const type = node.type;

        if (type === 'crawler') {
            // Find crawler by ID or name
            const crawlerIndex = newConfig.crawlers?.findIndex(c =>
                c.name === node.data.name || newConfig.crawlers?.indexOf(c) === parseInt(idParts[1])
            );
            if (crawlerIndex !== undefined && crawlerIndex >= 0 && newConfig.crawlers) {
                newConfig.crawlers[crawlerIndex] = newData as Crawler;
            }
        } else if (type === 'processor') {
            // Check if it's a legacy processor
            if (idParts[1] === 'legacy') {
                const crawlerIndex = parseInt(idParts[2]);
                if (newConfig.crawlers && newConfig.crawlers[crawlerIndex]) {
                    if (!newConfig.crawlers[crawlerIndex].cfg_crawler) {
                        newConfig.crawlers[crawlerIndex].cfg_crawler = {};
                    }
                    newConfig.crawlers[crawlerIndex].cfg_crawler!.processor = newData;
                }
            } else {
                // Independent processor
                if (!newConfig.processors) newConfig.processors = [];
                const processorIndex = newConfig.processors.findIndex(t =>
                    t.id === node.data.id || newConfig.processors?.indexOf(t) === parseInt(idParts[1])
                );
                if (processorIndex >= 0) {
                    newConfig.processors[processorIndex] = newData;
                } else {
                    newConfig.processors.push(newData);
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
            'crawler': ['processor', 'formatter'],
            'processor': ['formatter'],
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

        // Check for Bulk Connection
        const targetNode = nodes.find(n => n.id === nodeId);
        const sourceNode = nodes.find(n => n.id === sourceId);

        if (!isValidConnection(sourceNode, targetNode)) {
            alert('Invalid connection!');
            setIsDragging(false);
            setDragSource(null);
            setConnectingSource(null);
            return;
        }

        // Case 1: Source is selected, connect ALL selected to Target
        if (selectedNodeIds.has(sourceId) && selectedNodeIds.size > 1) {
            const applicableSources = Array.from(selectedNodeIds)
                .map(id => nodes.find(n => n.id === id))
                .filter(n => n && n.type === sourceNode?.type && isValidConnection(n, targetNode)); // same type only

            if (applicableSources.length > 1) {
                if (confirm(`Bulk Connect: Connect ${applicableSources.length} selected nodes to ${targetNode?.label}?`)) {
                    addConnections(applicableSources.map(s => ({ source: s!.id, target: nodeId })));
                    setIsDragging(false);
                    setDragSource(null);
                    setConnectingSource(null);
                    return;
                }
            }
        }

        // Case 2: Target is selected, connect Source to ALL selected Targets
        if (selectedNodeIds.has(nodeId) && selectedNodeIds.size > 1) {
            const applicableTargets = Array.from(selectedNodeIds)
                .map(id => nodes.find(n => n.id === id))
                .filter(n => n && n.type === targetNode?.type && isValidConnection(sourceNode, n));

            if (applicableTargets.length > 1) {
                if (confirm(`Bulk Connect: Connect ${sourceNode?.label} to ${applicableTargets.length} selected targets?`)) {
                    addConnections(applicableTargets.map(t => ({ source: sourceId, target: t!.id })));
                    setIsDragging(false);
                    setDragSource(null);
                    setConnectingSource(null);
                    return;
                }
            }
        }

        // Add single connection
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
        addConnections([{ source: sourceId, target: targetId }]);
    };

    const addConnections = (conns: { source: string, target: string }[]) => {
        if (!config || conns.length === 0) return;

        const newConfig = _.cloneDeep(config);
        if (!newConfig.connections) newConfig.connections = {};

        const newVisualConns: VisualConnection[] = [];
        let addedCount = 0;

        conns.forEach(({ source, target }) => {
            // Check existence
            if (connections.some(c => c.source === source && c.target === target) ||
                newVisualConns.some(c => c.source === source && c.target === target)) {
                return;
            }

            const sourceNode = nodes.find(n => n.id === source);
            const targetNode = nodes.find(n => n.id === target);
            if (!sourceNode || !targetNode) return;

            const connType = `${sourceNode.type}-${targetNode.type}`;

            // Add visual
            newVisualConns.push({
                id: `conn-${source}-${target}-${Date.now()}-${Math.random()}`,
                source,
                target,
                type: connType
            });
            addedCount++;

            // Update Config
            if (connType === 'crawler-processor') {
                if (!newConfig.connections!['crawler-processor']) newConfig.connections!['crawler-processor'] = {};
                (newConfig.connections!['crawler-processor'] as any)[source] = target;
            } else {
                // For arrays
                let mapName: keyof ConnectionMap | null = null;
                if (connType === 'processor-formatter') mapName = 'processor-formatter';
                else if (connType === 'crawler-formatter') mapName = 'crawler-formatter';
                else if (connType === 'formatter-target') mapName = 'formatter-target';
                else if (connType === 'forwarder-target') mapName = 'forwarder-target';

                if (mapName) {
                    if (!newConfig.connections![mapName]) newConfig.connections![mapName] = {} as any;
                    const map = newConfig.connections![mapName] as Record<string, string[]>;
                    if (!map[source]) map[source] = [];
                    if (!map[source].includes(target)) map[source].push(target);
                }
            }
        });

        if (addedCount > 0) {
            setConnections(prev => [...prev, ...newVisualConns]);
            setConfig(newConfig);
            setHasChanges(true);
        }
    };

    const removeConnection = (connId: string) => {
        if (!config) return;

        const conn = connections.find(c => c.id === connId);
        if (!conn) return;

        setConnections(prev => prev.filter(c => c.id !== connId));

        // Update config
        const newConfig = _.cloneDeep(config);
        if (!newConfig.connections) return;

        const connType = conn.type as keyof ConnectionMap;
        const connMap = newConfig.connections[connType];
        if (!connMap) return;

        if (conn.type === 'crawler-processor') {
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

    const addNewCrawler = () => {
        if (!config) return;

        const newCrawler = {
            name: `New Crawler ${Date.now()}`,
            cron: '0 * * * *',
            websites: [],
            paths: [],
            task_type: 'article' as const
        };

        const newConfig = _.cloneDeep(config);
        if (!newConfig.crawlers) newConfig.crawlers = [];
        newConfig.crawlers.push(newCrawler);

        setConfig(newConfig);
        processGraph(newConfig);
        setHasChanges(true);
    };

    const addNewProcessor = () => {
        if (!config) return;

        const newProcessor = {
            id: `processor-${Date.now()}`,
            name: `New Processor ${Date.now()}`,
            provider: 'Global', // Default
            api_key: ''
        };

        const newConfig = _.cloneDeep(config);
        if (!newConfig.processors) newConfig.processors = [];
        newConfig.processors.push(newProcessor);

        setConfig(newConfig);
        processGraph(newConfig);
        setHasChanges(true);
    };

    const handleCreateGroup = () => {
        if (selectedNodeIds.size === 0) return;
        const groupName = prompt('Enter group name:');
        if (!groupName) return;

        const newConfig = _.cloneDeep(config);
        if (!newConfig) return;

        const selectedNodes = nodes.filter(n => selectedNodeIds.has(n.id));
        selectedNodes.forEach(node => {
            const [type] = node.id.split('-');
            if (type === 'crawler') {
                const c = newConfig.crawlers?.find(x => x.name === node.data.name);
                if (c) c.group = groupName;
            } else if (type === 'forwarder') {
                const f = newConfig.forwarders?.find(x => x.id === node.data.id || x.name === node.data.name);
                if (f) f.group = groupName;
            } else if (type === 'formatter') {
                const f = newConfig.formatters?.find(x => x.id === node.data.id);
                if (f) f.group = groupName;
            } else if (type === 'target') {
                const t = newConfig.forward_targets?.find(x => x.id === node.data.id);
                if (t) t.group = groupName;
            } else if (type === 'processor') {
                const p = newConfig.processors?.find(x => x.id === node.data.id);
                if (p) p.group = groupName;
            }
        });

        setConfig(newConfig);
        processGraph(newConfig);
        setHasChanges(true);
        setSelectedNodeIds(new Set());
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

    const handleNodeClick = (node: VisualNode, meta: { shiftKey: boolean }) => {
        const newSelection = new Set(meta.shiftKey ? selectedNodeIds : []);
        if (newSelection.has(node.id)) {
            newSelection.delete(node.id);
        } else {
            newSelection.add(node.id);
        }
        setSelectedNodeIds(newSelection);
    };

    const handleToggleGroup = (groupId: string) => {
        const newCollapsed = new Set(collapsedGroups);
        if (newCollapsed.has(groupId)) {
            newCollapsed.delete(groupId);
        } else {
            newCollapsed.add(groupId);
        }
        setCollapsedGroups(newCollapsed);
        if (config) processGraph(config, newCollapsed);
    };

    const handleEditNode = (node: VisualNode) => {
        if (node.type === 'group') {
            handleToggleGroup(node.id);
            return;
        }
        setEditingNode(node);
    };

    const handleDeleteNodes = (nodeIdsToDelete: Set<string>) => {
        if (!config || nodeIdsToDelete.size === 0) return;

        if (!confirm(`Delete ${nodeIdsToDelete.size} selected item(s)?`)) return;

        const newConfig = _.cloneDeep(config);

        nodeIdsToDelete.forEach(nodeId => {
            // Find node to get metadata
            const visualNode = nodes.find(n => n.id === nodeId);
            if (!visualNode) return;

            const type = visualNode.type;
            const data = visualNode.data;

            // 1. Remove from Config Arrays
            if (type === 'crawler') {
                if (newConfig.crawlers) {
                    newConfig.crawlers = newConfig.crawlers.filter(c => c.name !== data.name);
                }
            } else if (type === 'forwarder') {
                if (newConfig.forwarders) {
                    newConfig.forwarders = newConfig.forwarders.filter(f => f.id !== data.id);
                }
            } else if (type === 'processor') {
                if (!visualNode.id.includes('legacy') && newConfig.processors) {
                    newConfig.processors = newConfig.processors.filter(p => p.id !== data.id);
                }
            } else if (type === 'formatter') {
                if (newConfig.formatters) {
                    newConfig.formatters = newConfig.formatters.filter(f => f.id !== data.id);
                }
            } else if (type === 'target') {
                if (newConfig.forward_targets) {
                    newConfig.forward_targets = newConfig.forward_targets.filter(t => t.id !== data.id);
                }
            } else if (type === 'group') {
                // If deleting a group node, we might want to just un-group?
                // Or delete everything in it?
                // Standard behavior: Delete group = Delete members usually?
                // Or Un-Group?
                // Let's safe choice: Alert "Cannot delete group node directly. Ungroup first."
                // Or just handle Un-Group logic here?
                const groupId = nodeId;
                const groupLabel = visualNode.label.split(' (')[0]; // simple parse
                const newCollapsed = new Set(collapsedGroups);
                newCollapsed.delete(groupId);
                setCollapsedGroups(newCollapsed);
                // But this function modifies config... 
                // Does config store groups? Yes via 'group' property on nodes.
                // If we delete the group node, we should ideally clear 'group' prop from members.
                // Implementation:
                const members = visualNode.data.members as VisualNode[];
                if (members) {
                    members.forEach(m => {
                        // Find member in newConfig and clear group
                        const mId = m.id;
                        // Only shallow search in newConfig lists...
                        // Or simpler: Reuse handleCreateGroup logic but setting group to undefined/null.
                        // Getting ID matching is hard.
                    });
                }
            }

            // 2. Remove Connections
            // We use the nodeId (which matches what is stored in connection maps hopefully)
            // Actually, for Crawlers, connection map uses ID (name?).
            // processGraph uses `getNodeId` which returns `name` for Crawlers.
            // So `nodeId` passed here IS the ID used in connections for Crawlers/Forwarders etc (except index-based fallbacks).

            if (newConfig.connections) {
                const conns = newConfig.connections;
                Object.keys(conns).forEach(connMapName => {
                    const map = conns[connMapName as keyof ConnectionMap];
                    if (!map) return;

                    const mapAny = map as any;

                    // Clean keys (sources)
                    if (mapAny[nodeId]) delete mapAny[nodeId];

                    // Clean values (targets)
                    Object.keys(mapAny).forEach(key => {
                        const val = mapAny[key];
                        if (Array.isArray(val)) {
                            mapAny[key] = val.filter((t: string) => t !== nodeId);
                        } else if (val === nodeId) {
                            delete mapAny[key];
                        }
                    });
                });
            }
        });

        setConfig(newConfig);
        processGraph(newConfig);
        setHasChanges(true);
        setSelectedNodeIds(new Set());
    };

    const handleDeleteNode = (nodeId: string) => {
        handleDeleteNodes(new Set([nodeId]));
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

            {/* Action Buttons - Fixed Position */}
            <div className="absolute top-20 right-4 z-40 flex flex-col gap-2 pointer-events-auto">
                {selectedNodeIds.size > 0 && (
                    <button
                        onClick={() => handleDeleteNodes(selectedNodeIds)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105 animate-fade-in"
                    >
                        <span className="text-lg">🗑️</span> Delete ({selectedNodeIds.size})
                    </button>
                )}
                {selectedNodeIds.size > 1 && (
                    <button
                        onClick={handleCreateGroup}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105 animate-fade-in"
                    >
                        <span className="text-lg">⚓</span> Create Group
                    </button>
                )}
                <button
                    onClick={addNewCrawler}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105"
                >
                    <span className="text-lg">+</span> Add Crawler
                </button>
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

            {/* Canvas */}
            <div
                ref={canvasRef}
                className="flex-grow relative overflow-auto bg-[url('/grid.svg')] bg-fixed"
                style={{ backgroundSize: '20px 20px' }}
                onMouseMove={(e) => {
                    if (canvasRef.current) {
                        const rect = canvasRef.current.getBoundingClientRect();
                        const x = e.clientX - rect.left + canvasRef.current.scrollLeft;
                        const y = e.clientY - rect.top + canvasRef.current.scrollTop;

                        if (isDragging) {
                            setMousePos({ x, y });
                        }

                        if (isBrushSelecting) {
                            setBrushCurrent({ x, y });
                        }
                    }
                }}
                onMouseUp={(e) => {
                    if (isDragging) {
                        setIsDragging(false);
                        setDragSource(null);
                        setConnectingSource(null);
                    }

                    if (isBrushSelecting) {
                        setIsBrushSelecting(false);
                        // Calculate intersection
                        const x = Math.min(brushStart.x, brushCurrent.x);
                        const y = Math.min(brushStart.y, brushCurrent.y);
                        const w = Math.abs(brushCurrent.x - brushStart.x);
                        const h = Math.abs(brushCurrent.y - brushStart.y);

                        // Ignore tiny clicks
                        if (w > 5 || h > 5) {
                            const newSelection = new Set(e.shiftKey ? selectedNodeIds : []); // Keep existing if shift

                            nodes.forEach(node => {
                                // Check intersection
                                if (
                                    node.x < x + w &&
                                    node.x + node.width > x &&
                                    node.y < y + h &&
                                    node.y + node.height > y
                                ) {
                                    newSelection.add(node.id);
                                }
                            });
                            setSelectedNodeIds(newSelection);
                        }
                    }
                }}
                onClick={() => {
                    if (connectingSource) {
                        setConnectingSource(null);
                    }
                    if (!isDragging && !isBrushSelecting) {
                        if (Math.abs(brushCurrent.x - brushStart.x) < 5 && Math.abs(brushCurrent.y - brushStart.y) < 5) {
                            setSelectedNodeIds(new Set());
                        }
                    }
                }}
            >
                {/* Canvas Click/Drag Handler Layer */}
                <div
                    className="absolute inset-0 z-0"
                    onMouseDown={(e) => {
                        // Only start brush if clicking directly on background, not on a node/connection (handled by stopPropagation there)
                        // And only if not in connection-drag mode
                        if (!isDragging && !connectingSource && e.button === 0) {
                            if (canvasRef.current) {
                                const rect = canvasRef.current.getBoundingClientRect();
                                const x = e.clientX - rect.left + canvasRef.current.scrollLeft;
                                const y = e.clientY - rect.top + canvasRef.current.scrollTop;
                                setIsBrushSelecting(true);
                                setBrushStart({ x, y });
                                setBrushCurrent({ x, y });

                                // Clear selection if not holding shift? 
                                if (!e.shiftKey) {
                                    setSelectedNodeIds(new Set());
                                }
                            }
                        }
                    }}
                />

                {/* Legend */}
                <div className="absolute bottom-4 left-4 bg-gray-900/90 border border-gray-700 p-3 rounded-lg shadow-xl backdrop-blur-sm z-50 pointer-events-none select-none">
                    <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Legend</h3>
                    <div className="flex flex-col gap-2 text-xs text-gray-300">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                            <span>Crawler</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                            <span>Translator</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-pink-500"></div>
                            <span>Formatter</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                            <span>Target</span>
                        </div>
                        <div className="h-px bg-gray-700 my-1"></div>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-0.5 bg-gray-500"></div>
                            <span>Connection</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-0.5 bg-amber-500"></div>
                            <span>Partial Conn</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border border-dashed border-indigo-400 bg-indigo-900/30"></div>
                            <span>Group</span>
                        </div>
                    </div>
                </div>

                <div
                    className="absolute inset-0"
                    style={{ minWidth: canvasSize.width, minHeight: canvasSize.height }}
                >
                    {/* Action Buttons */}
                    <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                        {selectedNodeIds.size > 1 && (
                            <button
                                onClick={handleCreateGroup}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105 animate-fade-in"
                            >
                                <span className="text-lg">⚓</span> Create Group
                            </button>
                        )}
                        <button
                            onClick={addNewCrawler}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all hover:scale-105"
                        >
                            <span className="text-lg">+</span> Add Crawler
                        </button>
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

                    {/* Groups Layer */}
                    <div className="absolute inset-0 z-0">
                        {groups.map(group => !group.isCollapsed && (
                            <div
                                key={group.id}
                                className="absolute border-2 rounded-xl transition-all pointer-events-none"
                                style={{
                                    left: group.x,
                                    top: group.y,
                                    width: group.width,
                                    height: group.height,
                                    borderColor: group.color,
                                    backgroundColor: `${group.color}05`, // 5% opacity
                                }}
                            >
                                <div
                                    className="absolute -top-7 left-0 flex items-center gap-2 pointer-events-auto"
                                >
                                    <div
                                        className="px-2 py-1 text-xs font-bold text-white rounded uppercase tracking-wider shadow-sm flex items-center gap-2"
                                        style={{ backgroundColor: group.color }}
                                    >
                                        {group.label}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleGroup(group.id);
                                            }}
                                            className="hover:bg-black/20 rounded p-0.5"
                                            title="Collapse Group"
                                        >
                                            ➖
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
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

                            const color = conn.isPartial ? '#f59e0b' : // Orange/Yellow for Partial
                                conn.type === 'crawler-translator' ? '#8b5cf6' :
                                    conn.type === 'translator-formatter' ? '#ec4899' :
                                        conn.type === 'crawler-formatter' ? '#f59e0b' :
                                            conn.type === 'formatter-target' ? '#10b981' :
                                                conn.type === 'forwarder-target' ? '#c026d3' : '#6b7280';

                            const isSelected = selectedNodeIds.has(conn.source) || selectedNodeIds.has(conn.target);

                            return (
                                <g key={conn.id} className="group">
                                    {/* Ghost Path for easy clicking */}
                                    <path
                                        d={`M ${startX} ${startY} C ${startX + 50} ${startY}, ${endX - 50} ${endY}, ${endX} ${endY}`}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth="20"
                                        className="cursor-pointer"
                                        style={{ pointerEvents: 'stroke' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('Delete this connection?')) {
                                                removeConnection(conn.id);
                                            }
                                        }}
                                        onMouseEnter={() => {
                                            // Optional: could set a hover state here if needed
                                        }}
                                    />
                                    {/* Visible Path */}
                                    <path
                                        d={`M ${startX} ${startY} C ${startX + 50} ${startY}, ${endX - 50} ${endY}, ${endX} ${endY}`}
                                        fill="none"
                                        stroke={isSelected ? '#ffffff' : color}
                                        strokeWidth={isSelected ? '3' : '2'}
                                        strokeDasharray={isSelected ? 'none' : '5,5'}
                                        className="pointer-events-none group-hover:stroke-red-500 group-hover:stroke-width-4 transition-all"
                                        style={{ opacity: isSelected ? 1 : 0.6, filter: isSelected ? 'drop-shadow(0 0 5px rgba(255,255,255,0.5))' : 'none' }}
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

                    {/* Brush Selection Box */}
                    {isBrushSelecting && (
                        <div
                            className="absolute border border-blue-500 bg-blue-500/20 pointer-events-none z-50"
                            style={{
                                left: Math.min(brushStart.x, brushCurrent.x),
                                top: Math.min(brushStart.y, brushCurrent.y),
                                width: Math.abs(brushCurrent.x - brushStart.x),
                                height: Math.abs(brushCurrent.y - brushStart.y),
                            }}
                        />
                    )}

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
                            // onClick={(n) => setEditingNode(n)} // OLD SINGLE CLICK
                            onClick={handleNodeClick}
                            onEdit={handleEditNode}
                            onDelete={handleDeleteNode}
                            isSelected={selectedNodeIds.has(node.id)}
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
            {
                showDebug && config && (
                    <div className="h-64 border-t border-white/10 bg-black/90 p-4 font-mono text-xs overflow-auto">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-bold text-lg text-purple-300">Backend Config Debug</h3>
                            <button onClick={() => setShowDebug(false)} className="text-white/60 hover:text-white">✕ Close</button>
                        </div>
                        <pre className="text-green-400 whitespace-pre-wrap">
                            {JSON.stringify(config, null, 2)}
                        </pre>
                    </div>
                )
            }

            {/* Editor Modal */}
            {
                editingNode && config && (
                    <ConfigEditor
                        node={editingNode}
                        fullConfig={config}
                        availableCookies={availableCookies}
                        onSave={handleNodeSave}
                        onClose={() => setEditingNode(null)}
                    />
                )
            }

            {/* Review Modal */}
            {
                showReview && config && originalConfig && (
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
                )
            }
        </div >
    );
}
