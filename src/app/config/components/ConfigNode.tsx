import { VisualNode } from '../types';

interface ConfigNodeProps {
    node: VisualNode;
    onClick: (node: VisualNode, meta: { shiftKey: boolean }) => void;
    onEdit?: (node: VisualNode) => void;
    onDelete?: (nodeId: string) => void;
    onConnectionStart?: (nodeId: string, side: 'output') => void;
    onConnectionEnd?: (nodeId: string, side: 'input') => void;
    onHandleClick?: (nodeId: string, side: 'input' | 'output') => void;
    isConnecting?: boolean;
    isConnectingSource?: boolean;
    isSelected?: boolean;
}

export default function ConfigNode({
    node,
    onClick,
    onEdit,
    onDelete,
    onConnectionStart,
    onConnectionEnd,
    onHandleClick,
    isConnecting,
    isConnectingSource,
    isSelected
}: ConfigNodeProps) {
    const getNodeStyle = (type: string) => {
        const baseStyle = 'border-l-4 shadow-lg backdrop-blur-sm bg-gray-900/90 transition-all hover:translate-y-[-2px] hover:shadow-xl';
        switch (type) {
            case 'crawler': return `${baseStyle} border-blue-500 shadow-blue-900/20`;
            case 'translator': return `${baseStyle} border-purple-500 shadow-purple-900/20`;
            case 'forwarder': return `${baseStyle} border-orange-500 shadow-orange-900/20`;
            case 'formatter': return `${baseStyle} border-pink-500 shadow-pink-900/20`;
            case 'target': return `${baseStyle} border-green-500 shadow-green-900/20`;
            case 'group': return `${baseStyle} border-dashed border-2 border-indigo-400 bg-indigo-900/80`;
            default: return `${baseStyle} border-gray-500`;
        }
    };

    return (
        <div
            className={`absolute flex flex-col justify-center items-start p-3 rounded-r-lg cursor-pointer group ${getNodeStyle(node.type)} ${isSelected ? 'ring-2 ring-yellow-400 z-30' : 'z-10'}`}
            style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
            }}
            onClick={(e) => {
                e.stopPropagation();
                onClick(node, { shiftKey: e.shiftKey || e.metaKey || e.ctrlKey });
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onEdit?.(node);
            }}
        >
            <div className="text-white font-bold text-sm w-full break-words whitespace-normal leading-snug mb-1" title={node.label}>
                {node.label}
            </div>
            <div className="text-xs text-white/40 uppercase tracking-widest font-mono">
                {node.type}
            </div>

            {/* Status indicator if enabled/disabled */}
            {node.data?.enabled === false && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" title="Disabled" />
            )}

            {/* Schedule indicator for crawlers/forwarders */}
            {(node.type === 'crawler' || node.type === 'forwarder') && node.data?.cfg_crawler?.cron && (
                <div className="absolute bottom-2 right-2 text-[10px] text-white/50 font-mono bg-white/10 px-1 rounded">
                    {node.data?.cfg_crawler?.cron}
                </div>
            )}
            {(node.type === 'crawler' || node.type === 'forwarder') && node.data?.cfg_forwarder?.cron && (
                <div className="absolute bottom-2 right-2 text-[10px] text-white/50 font-mono bg-white/10 px-1 rounded">
                    {node.data?.cfg_forwarder?.cron}
                </div>
            )}

            {/* Selection Actions */}
            {isSelected && (
                <div className="absolute -top-10 left-0 flex gap-2 animate-fadeIn z-50">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit?.(node);
                        }}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded shadow-lg transition-colors flex items-center gap-1"
                    >
                        <span>✏️</span> Edit
                    </button>
                    {onDelete && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this node?')) onDelete(node.id);
                            }}
                            className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded shadow-lg transition-colors"
                        >
                            🗑️
                        </button>
                    )}
                </div>
            )}

            {/* Connection Handles */}
            {/* Output handle (right side) - for source connections */}
            {(node.type === 'crawler' || node.type === 'translator' || node.type === 'formatter' || node.type === 'forwarder' || node.type === 'group') && (
                <div
                    className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 rounded-full border-2 cursor-pointer transition-all z-20 ${isConnectingSource
                        ? 'bg-blue-500 border-blue-300 ring-2 ring-blue-500 ring-opacity-50 scale-125'
                        : 'bg-white/20 border-white/40 hover:bg-white/40 hover:scale-125'
                        }`}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        if (e.button === 0) { // Left click only
                            onConnectionStart?.(node.id, 'output');
                        }
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onHandleClick?.(node.id, 'output');
                    }}
                    title="Drag or Click to connect"
                />
            )}

            {/* Input handle (left side) - for target connections */}
            {(node.type === 'translator' || node.type === 'formatter' || node.type === 'target' || node.type === 'group') && (
                <div
                    className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 cursor-pointer transition-all z-20 ${isConnecting
                        ? 'bg-green-500/50 border-green-400 animate-pulse hover:!bg-green-500 hover:scale-125'
                        : 'bg-white/20 border-white/40 hover:bg-white/40 hover:scale-125'
                        }`}
                    onMouseUp={(e) => {
                        e.stopPropagation();
                        onConnectionEnd?.(node.id, 'input');
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onHandleClick?.(node.id, 'input');
                    }}
                    title="Connect here"
                />
            )}
        </div>
    );
}
